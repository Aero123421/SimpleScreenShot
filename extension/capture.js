// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {clampCaptureGeometry, formatFilenamePattern} from './geometry.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot_stage_to_content');
Gio._promisify(Shell.Screenshot, 'composite_to_stream');
Gio._promisify(Gio.File.prototype, 'create_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.File.prototype, 'make_directory_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async');
Gio._promisify(Gio.OutputStream.prototype, 'close_async');

const PREVIEW_MAX_EDGE = 256;

function isGioError(error, code) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, code);
}

async function ensureDirectoryAsync(path) {
    const missing = [];
    let current = Gio.File.new_for_path(path);
    while (current) {
        try {
            await current.query_info_async(
                'standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
            break;
        } catch (error) {
            if (!isGioError(error, Gio.IOErrorEnum.NOT_FOUND))
                throw error;
            missing.push(current);
            current = current.get_parent();
        }
    }
    for (let i = missing.length - 1; i >= 0; i--) {
        try {
            await missing[i].make_directory_async(GLib.PRIORITY_DEFAULT, null);
        } catch (error) {
            if (!isGioError(error, Gio.IOErrorEnum.EXISTS))
                throw error;
        }
    }
    return Gio.File.new_for_path(path);
}

function defaultPicturesDirectory() {
    const pictures = GLib.get_user_special_dir(
        GLib.UserDirectory.DIRECTORY_PICTURES) ?? GLib.get_home_dir();
    return GLib.build_filenamev([pictures, 'Screenshots']);
}

function runtimeCaptureDirectory() {
    return GLib.build_filenamev([GLib.get_user_runtime_dir(), 'simple-screenshot']);
}

function expandUserDirectory(path) {
    if (path === '~')
        return GLib.get_home_dir();
    if (path.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
    return path;
}

async function createUniqueFileAsync(directory, basename) {
    for (let suffix = 0; suffix < 10000; suffix++) {
        const tail = suffix === 0 ? '' : `-${suffix + 1}`;
        const file = directory.get_child(`${basename}${tail}.png`);
        try {
            const stream = await file.create_async(
                Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, null);
            return {file, stream};
        } catch (error) {
            if (isGioError(error, Gio.IOErrorEnum.EXISTS))
                continue;
            throw error;
        }
    }
    throw new Error('Could not allocate a unique screenshot filename');
}

async function writeAllBytesAndCloseAsync(file, stream, bytes) {
    const data = bytes.toArray();
    let offset = 0;
    try {
        while (offset < data.length) {
            const chunk = GLib.Bytes.new(data.subarray(offset));
            const written = await stream.write_bytes_async(
                chunk, GLib.PRIORITY_DEFAULT, null);
            if (written <= 0)
                throw new Error('Incomplete write while saving screenshot');
            offset += written;
        }
        await stream.close_async(GLib.PRIORITY_DEFAULT, null);
    } catch (error) {
        try {
            await stream.close_async(GLib.PRIORITY_DEFAULT, null);
        } catch (_closeError) {
            // Ignore secondary close error while cleaning up partial file.
        }
        try {
            await file.delete_async(GLib.PRIORITY_DEFAULT, null);
        } catch (_deleteError) {
            // Best-effort cleanup of incomplete file.
        }
        throw error;
    }
}

async function readHistoryFileAsync(filePath) {
    try {
        const file = Gio.File.new_for_path(filePath);
        const [contents] = await file.load_contents_async(null);
        const parsed = JSON.parse(new TextDecoder().decode(contents));
        if (!Array.isArray(parsed))
            throw new Error('History index is not a JSON array');
        return parsed;
    } catch (error) {
        if (isGioError(error, Gio.IOErrorEnum.NOT_FOUND))
            return [];
        throw error;
    }
}

async function writeJsonAsync(filePath, value) {
    const file = Gio.File.new_for_path(filePath);
    const encoded = new TextEncoder().encode(JSON.stringify(value, null, 2));
    await file.replace_contents_bytes_async(
        GLib.Bytes.new(encoded),
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
    );
}

function dateParts(dateTime) {
    return {
        year: dateTime.format('%Y'),
        month: dateTime.format('%m'),
        day: dateTime.format('%d'),
        hour: dateTime.format('%H'),
        minute: dateTime.format('%M'),
        second: dateTime.format('%S'),
    };
}

function isSaveDisabledByLockdown() {
    try {
        const source = Gio.SettingsSchemaSource.get_default();
        if (!source?.lookup('org.gnome.desktop.lockdown', true))
            return false;
        const lockdown = new Gio.Settings({schema_id: 'org.gnome.desktop.lockdown'});
        return lockdown.get_boolean('disable-save-to-disk');
    } catch (_error) {
        return false;
    }
}

function isPathInsideDirectory(filePath, directoryPath) {
    const prefix = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`;
    return typeof filePath === 'string' && filePath.startsWith(prefix);
}

export class CaptureService {
    constructor(settings) {
        this._settings = settings;
        this._historyPath = GLib.build_filenamev([
            GLib.get_user_data_dir(), 'simple-screenshot', 'history.json',
        ]);
        this._historyQueue = Promise.resolve();
    }

    async prepare() {
        const shooter = new Shell.Screenshot();
        const [content, scale, cursorContent, cursorPoint, cursorScale] =
            await shooter.screenshot_stage_to_content();

        return {
            content,
            texture: content.get_texture(),
            scale,
            cursorContent,
            cursorPoint,
            cursorScale,
        };
    }

    async capture(snapshot, target, shouldContinue = () => true) {
        const stream = Gio.MemoryOutputStream.new_resizable();
        const includePointer = Boolean(target.includePointer);
        const cursorTexture = includePointer
            ? snapshot.cursorContent?.get_texture() ?? null
            : null;

        let pixbuf;
        if (target.mode === 'window') {
            if (!target.windowTarget?.texture) {
                stream.close(null);
                throw new Error('Selected window content is unavailable');
            }
            const {texture, bufferScale, bufferRect, ownsCursor} = target.windowTarget;
            const windowCursor = ownsCursor ? cursorTexture : null;
            const cursorX = ((snapshot.cursorPoint?.x ?? 0) - bufferRect.x) * bufferScale;
            const cursorY = ((snapshot.cursorPoint?.y ?? 0) - bufferRect.y) * bufferScale;
            pixbuf = await Shell.Screenshot.composite_to_stream(
                texture,
                0, 0, -1, -1,
                bufferScale,
                windowCursor,
                cursorX,
                cursorY,
                snapshot.cursorScale ?? 1,
                stream
            );
        } else {
            const scale = snapshot.scale;
            const scaled = clampCaptureGeometry(
                target.rect,
                scale,
                snapshot.texture.get_width(),
                snapshot.texture.get_height()
            );
            if (!scaled) {
                stream.close(null);
                throw new Error('Selected capture region is outside the screen');
            }
            pixbuf = await Shell.Screenshot.composite_to_stream(
                snapshot.texture,
                ...scaled,
                scale,
                cursorTexture,
                (snapshot.cursorPoint?.x ?? 0) * scale,
                (snapshot.cursorPoint?.y ?? 0) * scale,
                snapshot.cursorScale ?? 1,
                stream
            );
        }
        stream.close(null);

        if (!shouldContinue())
            return null;

        const bytes = stream.steal_as_bytes();
        global.display.get_sound_player().play_from_theme(
            'screen-capture', 'Screenshot taken', null);

        const copiedToClipboard = this._settings.get_boolean('copy-to-clipboard');
        if (copiedToClipboard) {
            St.Clipboard.get_default().set_content(
                St.ClipboardType.CLIPBOARD, 'image/png', bytes);
        }

        const saveDisabledByPolicy = isSaveDisabledByLockdown();
        if (saveDisabledByPolicy) {
            return {
                file: null,
                pixbuf,
                copiedToClipboard,
                savedPermanently: false,
                saveDisabledByPolicy: true,
            };
        }

        const savedPermanently = this._settings.get_boolean('save-copies');
        const file = await this._writeCaptureAsync(bytes, savedPermanently);
        if (!shouldContinue()) {
            if (!savedPermanently) {
                try {
                    await file.delete_async(GLib.PRIORITY_DEFAULT, null);
                } catch (_deleteError) {
                    // Best-effort cleanup of unindexed temporary capture.
                }
            }
            return null;
        }

        const limit = this._settings.get_int('history-limit');
        this._queueHistoryUpdate(file, pixbuf, savedPermanently, limit);

        return {
            file,
            pixbuf,
            copiedToClipboard,
            savedPermanently,
            saveDisabledByPolicy: false,
        };
    }

    async _writeCaptureAsync(bytes, keepCopy) {
        let directoryPath;
        if (keepCopy) {
            const configured = this._settings.get_string('save-directory');
            directoryPath = configured.trim().length > 0
                ? expandUserDirectory(configured)
                : defaultPicturesDirectory();
        } else {
            directoryPath = runtimeCaptureDirectory();
        }

        const directory = await ensureDirectoryAsync(directoryPath);
        const now = GLib.DateTime.new_now_local();
        const basename = formatFilenamePattern(
            this._settings.get_string('filename-pattern'),
            dateParts(now)
        );

        const {file, stream} = await createUniqueFileAsync(directory, basename);
        await writeAllBytesAndCloseAsync(file, stream, bytes);
        return file;
    }

    _queueHistoryUpdate(file, pixbuf, savedPermanently, limit) {
        const entry = {
            path: file.get_path(),
            uri: file.get_uri(),
            createdAt: GLib.DateTime.new_now_local().format_iso8601(),
            width: pixbuf.width,
            height: pixbuf.height,
            temporary: !savedPermanently,
        };

        this._historyQueue = this._historyQueue
            .then(() => this._appendHistoryAsync(entry, limit))
            .catch(error => {
                console.error(`Unable to update screenshot history: ${error.message}`);
            });
    }

    async _appendHistoryAsync(entry, limit) {
        await ensureDirectoryAsync(GLib.path_get_dirname(this._historyPath));
        const history = await readHistoryFileAsync(this._historyPath);
        history.unshift(entry);

        const kept = history.slice(0, limit);
        const evicted = history.slice(limit);
        await writeJsonAsync(this._historyPath, kept);

        // Clean up extension-owned temporary captures once evicted from history.
        const runtimeDir = runtimeCaptureDirectory();
        const keptPaths = new Set(kept.map(item => item?.path));
        for (const old of evicted) {
            if (!old?.temporary || !old?.path || keptPaths.has(old.path))
                continue;
            if (!isPathInsideDirectory(old.path, runtimeDir))
                continue;
            try {
                await Gio.File.new_for_path(old.path).delete_async(
                    GLib.PRIORITY_DEFAULT, null);
            } catch (_error) {
                // Already deleted or inaccessible.
            }
        }
    }

    static previewContent(pixbuf) {
        let preview = pixbuf;
        const maxDim = Math.max(pixbuf.width, pixbuf.height);
        if (maxDim > PREVIEW_MAX_EDGE) {
            const ratio = PREVIEW_MAX_EDGE / maxDim;
            const scaled = pixbuf.scale_simple(
                Math.max(1, Math.round(pixbuf.width * ratio)),
                Math.max(1, Math.round(pixbuf.height * ratio)),
                GdkPixbuf.InterpType.BILINEAR
            );
            if (scaled)
                preview = scaled;
        }

        const pixels = preview.read_pixel_bytes();
        const content = St.ImageContent.new_with_preferred_size(
            preview.width, preview.height);
        const hasAlpha = preview.get_has_alpha();
        content.set_bytes(
            pixels,
            hasAlpha ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
            preview.width,
            preview.height,
            preview.rowstride
        );
        return content;
    }
}
