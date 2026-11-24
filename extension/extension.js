// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {CaptureService} from './capture.js';
import {CaptureIndicator} from './indicator.js';
import {SnippingOverlay} from './overlay.js';
import {t} from './i18n.js';

const SHORTCUT_KEY = 'simple-screenshot-open-overlay';
const LEGACY_SHORTCUT_KEY = 'shortcut';

function monitorsSignature() {
    return Main.layoutManager.monitors
        .map(m => `${m.x},${m.y},${m.width},${m.height},${m.geometry_scale ?? 1}`)
        .join('|');
}

function showFileInManager(fileUri, filePath) {
    const fallback = () => {
        const parent = Gio.File.new_for_path(filePath).get_parent();
        const manager = Gio.app_info_get_default_for_type('inode/directory', false);
        manager?.launch([parent], global.create_app_launch_context(0, -1));
    };
    try {
        Gio.DBus.session.call(
            'org.freedesktop.FileManager1',
            '/org/freedesktop/FileManager1',
            'org.freedesktop.FileManager1',
            'ShowItems',
            new GLib.Variant('(ass)', [[fileUri], '']),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (_connection, result) => {
                try {
                    Gio.DBus.session.call_finish(result);
                } catch (_dbusError) {
                    fallback();
                }
            }
        );
    } catch (_error) {
        fallback();
    }
}

export default class SimpleScreenshotExtension extends Extension {
    enable() {
        this._sessionId = (this._sessionId ?? 0) + 1;
        this._settings = this.getSettings();
        this._captureService = new CaptureService(this._settings);
        this._overlay = null;
        this._openingOverlay = false;
        this._deferredOpenId = 0;
        this._indicator = null;
        this._notificationSource = null;

        this._migrateLegacyShortcut();

        Main.wm.addKeybinding(
            SHORTCUT_KEY,
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL,
            () => this.openOverlay()
        );

        this._indicatorSignal = this._settings.connect(
            'changed::show-indicator', () => this._syncIndicator());
        this._syncIndicator();
    }

    disable() {
        this._sessionId = (this._sessionId ?? 0) + 1;
        Main.wm.removeKeybinding(SHORTCUT_KEY);
        if (this._deferredOpenId) {
            GLib.Source.remove(this._deferredOpenId);
            this._deferredOpenId = 0;
        }
        const overlay = this._overlay;
        this._overlay = null;
        overlay?.cancel();
        this._openingOverlay = false;
        this._indicator?.destroy();
        this._indicator = null;
        this._notificationSource?.destroy();
        this._notificationSource = null;
        if (this._indicatorSignal)
            this._settings.disconnect(this._indicatorSignal);
        this._indicatorSignal = 0;
        this._captureService = null;
        this._settings = null;
    }

    _migrateLegacyShortcut() {
        if (this._settings.get_user_value(SHORTCUT_KEY) !== null)
            return;

        if (this._settings.get_user_value(LEGACY_SHORTCUT_KEY) !== null) {
            this._settings.set_strv(
                SHORTCUT_KEY,
                this._settings.get_strv(LEGACY_SHORTCUT_KEY)
            );
        }
    }

    openOverlayDeferred(mode = null, delayMs = 60) {
        if (this._deferredOpenId)
            GLib.Source.remove(this._deferredOpenId);

        const sessionId = this._sessionId;
        this._deferredOpenId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._deferredOpenId = 0;
            if (sessionId === this._sessionId)
                this.openOverlay(mode);
            return GLib.SOURCE_REMOVE;
        });
    }

    async openOverlay(mode = null) {
        if (this._overlay || this._openingOverlay)
            return;

        // Avoid capturing Overview transformed previews where window geometry differs.
        if (Main.overview.visible) {
            Main.overview.hide();
            this.openOverlayDeferred(mode, 280);
            return;
        }

        const sessionId = this._sessionId;
        const beforeMonitors = monitorsSignature();
        this._openingOverlay = true;
        let overlay = null;
        try {
            const snapshot = await this._captureService.prepare();
            if (sessionId !== this._sessionId || !this._settings)
                return;
            if (Main.overview.visible || monitorsSignature() !== beforeMonitors)
                return;

            overlay = new SnippingOverlay({
                initialMode: mode ?? this._settings.get_string('default-mode'),
                includePointer: this._settings.get_boolean('include-pointer'),
                onCapture: (prepared, target) => this._capture(prepared, target, sessionId),
                onCancel: () => {
                    if (this._overlay === overlay)
                        this._overlay = null;
                },
                onSettings: () => this.openPreferences(),
            });
            overlay.connect('destroy', () => {
                if (this._overlay === overlay)
                    this._overlay = null;
            });
            this._overlay = overlay;
            overlay.open(snapshot);
        } catch (error) {
            if (this._overlay === overlay)
                this._overlay = null;
            if (sessionId === this._sessionId) {
                console.error(`Unable to open Simple ScreenShot: ${error.message}`);
                Main.notifyError('Simple ScreenShot', error.message);
            }
        } finally {
            if (sessionId === this._sessionId)
                this._openingOverlay = false;
        }
    }

    async _capture(snapshot, target, sessionId) {
        if (sessionId !== this._sessionId || !this._captureService)
            return;

        try {
            const result = await this._captureService.capture(
                snapshot,
                target,
                () => sessionId === this._sessionId && Boolean(this._settings)
            );
            if (!result || sessionId !== this._sessionId || !this._settings)
                return;

            if (result.file && this._settings.get_boolean('auto-open-editor'))
                this.openEditor(result.file.get_path());
            if (this._settings.get_boolean('show-notification'))
                this._showNotification(result);
        } catch (error) {
            if (sessionId === this._sessionId) {
                console.error(`Unable to save screenshot: ${error.message}`);
                Main.notifyError('Simple ScreenShot', error.message);
            }
        }
    }

    _getNotificationSource() {
        if (!this._notificationSource) {
            this._notificationSource = new MessageTray.Source({
                title: 'Simple ScreenShot',
                iconName: 'camera-photo-symbolic',
            });
            this._notificationSource.connect('destroy', () => {
                this._notificationSource = null;
            });
            Main.messageTray.add(this._notificationSource);
        }
        return this._notificationSource;
    }

    _showNotification(result) {
        const source = this._getNotificationSource();
        const filePath = result.file?.get_path() ?? null;
        const fileUri = result.file?.get_uri() ?? null;

        let body;
        if (result.saveDisabledByPolicy) {
            body = result.copiedToClipboard
                ? t('notificationCopiedOnlyBody')
                : t('notificationSaveDisabledBody');
        } else if (result.copiedToClipboard) {
            body = t('notificationCopiedBody');
        } else {
            body = t('notificationBody');
        }

        const notification = new MessageTray.Notification({
            source,
            title: t('captured'),
            body,
            gicon: CaptureService.previewContent(result.pixbuf),
            isTransient: true,
        });

        if (filePath) {
            notification.connect('activated', () => this.openEditor(filePath));
            notification.addAction(t('edit'), () => this.openEditor(filePath));
        }

        if (result.savedPermanently && fileUri && filePath) {
            notification.addAction(t('showFiles'), () =>
                showFileInManager(fileUri, filePath));
        }

        source.addNotification(notification);
    }

    openEditor(filePath = null) {
        const editor = `${this.path}/editor/main.js`;
        const argv = ['gjs', '-m', editor];
        if (filePath)
            argv.push(filePath);

        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        } catch (error) {
            console.error(`${t('openFailed')}: ${error.message}`);
            Main.notifyError('Simple ScreenShot', t('openFailed'));
        }
    }

    _syncIndicator() {
        const shouldShow = this._settings.get_boolean('show-indicator');
        if (shouldShow && !this._indicator) {
            this._indicator = new CaptureIndicator(this);
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!shouldShow && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
