#!/usr/bin/gjs -m
// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

import {EditorApplication} from './application.js';
import {ScreenshotCanvas} from './canvas.js';
import {EditorWindow} from './window.js';

const extensionPath = Gio.File.new_for_uri(import.meta.url)
    .get_parent()
    .get_parent()
    .get_path();

function pixelAt(pixbuf, x, y) {
    const channels = pixbuf.get_n_channels();
    const offset = y * pixbuf.rowstride + x * channels;
    const pixels = pixbuf.get_pixels();
    return [
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        channels >= 4 ? pixels[offset + 3] : 255,
    ];
}

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function runSelfTest(inputPath, outputPath) {
    Adw.init();
    const canvas = new ScreenshotCanvas();
    canvas.loadFile(inputPath);
    assert(!canvas.isDirty, 'Freshly loaded image must not be dirty');

    canvas.addText(24, 24, 'Simple ScreenShot\n日本語テスト');
    assert(canvas.isDirty, 'Editing must mark canvas dirty');

    // Verify undo back to initial revision clears dirty state, and redo restores it.
    canvas.undo();
    assert(!canvas.isDirty, 'Undoing back to initial state must clear dirty');
    canvas.redo();
    assert(canvas.isDirty, 'Redoing must restore dirty state and annotation');
    assert(canvas.hasAnnotations, 'Redo must restore text annotation');

    canvas.addAnnotation({
        type: 'pen', color: '#ff3b30', width: 4,
        points: [{x: 40, y: 120}, {x: 110, y: 150}, {x: 180, y: 115}, {x: 240, y: 145}],
    });
    canvas.addAnnotation({
        type: 'pen', color: '#ff3b30', width: 8,
        points: [{x: 255, y: 145}],
    });
    canvas.addAnnotation({
        type: 'highlighter', color: '#ffd60a', width: 5,
        points: [{x: 260, y: 120}, {x: 430, y: 120}],
    });
    canvas.addAnnotation({
        type: 'arrow', color: '#0a84ff', width: 5,
        start: {x: 460, y: 110}, end: {x: 610, y: 170},
    });
    canvas.addAnnotation({
        type: 'rectangle', color: '#34c759', width: 5,
        start: {x: 640, y: 70}, end: {x: 880, y: 170},
    });
    canvas.addAnnotation({
        type: 'ellipse', color: '#ff3b30', width: 4,
        start: {x: 660, y: 210}, end: {x: 860, y: 340},
    });

    // Draw a bright green bar over the button and then mosaic across it to prove
    // mosaic samples composited annotations rather than reverting to base pixels.
    canvas.addAnnotation({
        type: 'pen', color: '#00ff00', width: 14,
        points: [{x: 160, y: 332}, {x: 320, y: 332}],
    });
    canvas.addAnnotation({
        type: 'mosaic', color: '#000000', width: 4, blockSize: 12,
        start: {x: 130, y: 295}, end: {x: 365, y: 370},
    });

    canvas.clearAnnotations();
    assert(!canvas.hasAnnotations, 'clearAnnotations should empty annotations');
    canvas.undo();
    assert(canvas.hasAnnotations, 'undo after clearAnnotations should restore annotations');

    canvas.setPendingCrop({x: 10, y: 10, width: 930, height: 520});
    canvas.applyPendingCrop();
    const saved = canvas.exportPng(outputPath);
    assert(saved.width === 930 && saved.height === 520, 'Saved metadata dimensions mismatch');
    assert(Boolean(saved.etag), 'Atomic save must return an ETag');

    const result = GdkPixbuf.Pixbuf.new_from_file(outputPath);
    assert(result.width === 930 && result.height === 520,
        `Unexpected export size: ${result.width}x${result.height}`);

    // Pixel check: green stroke inside mosaic must dominate over unmodified blue button (0, 103, 192).
    const [r, g, b] = pixelAt(result, 220, 322);
    assert(g > 150 && b < 150,
        `Expected mosaic to preserve prior bright green annotation (got rgb=${r},${g},${b})`);

    // Pixel check: ETag mismatch detection on concurrent modification.
    let etagRejected = false;
    try {
        canvas.exportPng(outputPath, {expectedEtag: 'stale-etag-value'});
    } catch (error) {
        etagRejected = error instanceof GLib.Error &&
            error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.WRONG_ETAG);
    }
    assert(etagRejected, 'exportPng must reject stale ETag');

    // Exclusive create check: Save As must reject a concurrently created destination.
    let exclusiveRejected = false;
    try {
        canvas.exportPng(outputPath, {exclusive: true});
    } catch (error) {
        exclusiveRejected = error instanceof GLib.Error &&
            error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS);
    }
    assert(exclusiveRejected, 'exportPng(exclusive) must reject existing file');

    // Permission & symlink preservation check on overwrite.
    const permTarget = `${outputPath}.perm-target.png`;
    const permLink = `${outputPath}.perm-link.png`;
    try {
        const targetFile = Gio.File.new_for_path(permTarget);
        const initStream = targetFile.create(Gio.FileCreateFlags.PRIVATE, null);
        initStream.write_all(canvas.exportPngBytes().toArray(), null);
        initStream.close(null);
        const linkFile = Gio.File.new_for_path(permLink);
        linkFile.make_symbolic_link(permTarget, null);
        canvas.exportPng(permLink);
        const linkInfo = linkFile.query_info(
            'standard::is-symlink', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        assert(linkInfo.get_is_symlink(), 'Overwrite must follow symlinks rather than replacing them');
        const modeInfo = targetFile.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
        const mode = modeInfo.get_attribute_uint32('unix::mode') & 0o777;
        assert(mode === 0o600, `Overwrite must preserve 0600 mode (got ${mode.toString(8)})`);
    } finally {
        GLib.unlink(permLink);
        GLib.unlink(permTarget);
    }

    // Error check: unwritable path must throw (not silently succeed like Cairo writeToPNG).
    let writeFailed = false;
    try {
        canvas.exportPng('/nonexistent-simple-screenshot-dir/out.png');
    } catch (_error) {
        writeFailed = true;
    }
    assert(writeFailed, 'exportPng must throw on unwritable destination');

    // Transparent-input mosaic check: mosaic must replace pixels via SOURCE (no alpha leak).
    const alphaCanvas = new ScreenshotCanvas();
    const alphaInput = `${outputPath}.alpha-in.png`;
    const alphaOutput = `${outputPath}.alpha-out.png`;
    try {
        const blank = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 48, 48);
        blank.fill(0x00000000);
        // Paint left half opaque red, right half fully transparent
        const leftHalf = blank.new_subpixbuf(0, 0, 24, 48);
        leftHalf.fill(0xff0000ff);
        blank.savev(alphaInput, 'png', [], []);

        alphaCanvas.loadFile(alphaInput);
        alphaCanvas.addAnnotation({
            type: 'mosaic', color: '#000000', width: 4, blockSize: 48,
            start: {x: 0, y: 0}, end: {x: 48, y: 48},
        });
        alphaCanvas.exportPng(alphaOutput);
        const alphaResult = GdkPixbuf.Pixbuf.new_from_file(alphaOutput);
        const [, , , aLeft] = pixelAt(alphaResult, 4, 24);
        const [, , , aRight] = pixelAt(alphaResult, 44, 24);
        assert(Math.abs(aLeft - aRight) <= 4 && aLeft > 80 && aLeft < 180,
            `Expected uniform translucent mosaic block across alpha boundary (left=${aLeft}, right=${aRight})`);
    } finally {
        GLib.unlink(alphaInput);
        GLib.unlink(alphaOutput);
    }

    console.log(`editor export test passed: ${outputPath}`);

    // Bounded window startup + icon verification smoke test.
    let windowTestError = null;
    let activated = false;
    const app = new EditorApplication(inputPath, extensionPath);
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
        windowTestError = new Error('Editor window smoke test timed out');
        app.quit();
        return GLib.SOURCE_REMOVE;
    });

    app.connect_after('activate', () => {
        activated = true;
        try {
            const display = Gdk.Display.get_default();
            const theme = Gtk.IconTheme.get_for_display(display);
            for (const icon of [
                'ss-pen-symbolic', 'ss-highlighter-symbolic', 'ss-arrow-symbolic',
                'ss-rectangle-symbolic', 'ss-ellipse-symbolic', 'ss-text-symbolic',
                'ss-mosaic-symbolic', 'ss-crop-symbolic',
            ]) {
                assert(theme.has_icon(icon), `Missing editor icon: ${icon}`);
            }
            const win = app.active_window ?? app.get_windows()[0] ?? null;
            assert(win instanceof EditorWindow, 'Expected EditorWindow instance to be constructed');
            assert(win.visible, 'Expected EditorWindow to be presented');
            assert(win.title.includes('fixture.svg'),
                `Expected window title to reference loaded file (got "${win.title}")`);
        } catch (error) {
            windowTestError = error;
        } finally {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                app.quit();
                return GLib.SOURCE_REMOVE;
            });
        }
    });

    app.run([]);
    GLib.Source.remove(timeoutId);
    if (windowTestError)
        throw windowTestError;
    assert(activated, 'EditorApplication failed to activate');
    console.log('editor window smoke test passed');
}

if (ARGV[0] === '--self-test') {
    const inputPath = ARGV[1];
    const outputPath = ARGV[2];
    if (!inputPath || !outputPath)
        throw new Error('Usage: main.js --self-test INPUT OUTPUT');
    try {
        runSelfTest(inputPath, outputPath);
    } catch (error) {
        console.error(`Self-test failed: ${error.message}`);
        System.exit(1);
    }
} else {
    const inputPath = ARGV.find(argument => !argument.startsWith('-')) ?? null;
    const application = new EditorApplication(inputPath, extensionPath);
    application.run([]);
}
