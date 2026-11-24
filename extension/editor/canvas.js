// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Gsk from 'gi://Gsk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import {
    clamp,
    constrainEndPoint,
    cropHandleAt,
    intersection,
    normalizeRect,
    resizeRectByHandle,
} from '../geometry.js';

const DRAWING_TOOLS = new Set([
    'pen', 'highlighter', 'arrow', 'rectangle', 'ellipse', 'mosaic', 'crop',
]);

const CANVAS_PADDING = 36;
const BASE_MIN_ZOOM = 0.25;
const MAX_ZOOM = 4.0;

const MOSAIC_BLOCKS = new Map([
    [2, 8],
    [4, 12],
    [8, 18],
    [14, 26],
]);

const HANDLE_CURSORS = {
    nw: 'nwse-resize',
    se: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    n: 'ns-resize',
    s: 'ns-resize',
    w: 'ew-resize',
    e: 'ew-resize',
    move: 'grab',
};

function rgba(hex, alpha = 1) {
    const value = hex.replace('#', '');
    return [
        Number.parseInt(value.slice(0, 2), 16) / 255,
        Number.parseInt(value.slice(2, 4), 16) / 255,
        Number.parseInt(value.slice(4, 6), 16) / 255,
        alpha,
    ];
}

function luminance(red, green, blue) {
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function validRect(rect) {
    return Boolean(rect && rect.width >= 2 && rect.height >= 2);
}

function drawRoundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.newSubPath();
    context.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    context.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    context.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    context.arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2);
    context.closePath();
}

function drawMosaicFromSurface(sourceSurface, targetContext, rect, blockSize, imgW, imgH) {
    const clipped = intersection(rect, {x: 0, y: 0, width: imgW, height: imgH});
    if (!validRect(clipped))
        return;

    const x = Math.round(clipped.x);
    const y = Math.round(clipped.y);
    const width = Math.max(1, Math.round(clipped.width));
    const height = Math.max(1, Math.round(clipped.height));
    const safeBlock = Math.max(4, Math.round(blockSize));
    const smallW = Math.max(1, Math.round(width / safeBlock));
    const smallH = Math.max(1, Math.round(height / safeBlock));

    const small = new Cairo.ImageSurface(Cairo.Format.ARGB32, smallW, smallH);
    try {
        const downCtx = new Cairo.Context(small);
        downCtx.setOperator(Cairo.Operator.SOURCE);
        downCtx.scale(smallW / width, smallH / height);
        downCtx.setSourceSurface(sourceSurface, -x, -y);
        downCtx.getSource().setFilter(Cairo.Filter.BILINEAR);
        downCtx.paint();

        targetContext.save();
        targetContext.rectangle(x, y, width, height);
        targetContext.clip();
        targetContext.setOperator(Cairo.Operator.SOURCE);
        targetContext.translate(x, y);
        targetContext.scale(width / smallW, height / smallH);
        targetContext.setSourceSurface(small, 0, 0);
        targetContext.getSource().setFilter(Cairo.Filter.NEAREST);
        targetContext.paint();
        targetContext.restore();
    } finally {
        small.finish();
    }
}

export const ScreenshotCanvas = GObject.registerClass({
    Signals: {
        changed: {},
        'history-changed': {},
        'pending-crop-changed': {},
        'file-changed': {},
        'zoom-changed': {},
    },
}, class ScreenshotCanvas extends Gtk.DrawingArea {
    _init({requestText = null, ...params} = {}) {
        super._init({
            hexpand: true,
            vexpand: true,
            focusable: true,
            ...params,
        });

        this._requestText = requestText;
        this._pixbuf = null;
        this._filePath = null;
        this._annotations = [];
        this._undo = [];
        this._redo = [];
        this._crop = null;
        this._pendingCrop = null;
        this._cropHandle = null;
        this._cropOrigin = null;
        this._preview = null;
        this._tool = 'pen';
        this._color = '#ff3b30';
        this._strokeWidth = 4;
        this._zoomMode = 'fit';
        this._zoom = 1;
        this._effectiveScale = 1;
        this._fitScale = 1;
        this._pointerDown = false;
        this._panning = false;
        this._view = null;
        this._cursorName = null;
        this._zoomIdleId = 0;

        this._nextRevisionId = 1;
        this._revisionId = 0;
        this._savedRevisionId = 0;

        this._committedSurface = null;
        this._committedSurfaceRevision = -1;

        this.connect('destroy', () => {
            if (this._zoomIdleId) {
                GLib.Source.remove(this._zoomIdleId);
                this._zoomIdleId = 0;
            }
            this._releaseCommittedSurface();
        });

        this.set_draw_func(this._draw.bind(this));

        this._click = Gtk.GestureClick.new();
        this._click.set_button(Gdk.BUTTON_PRIMARY);
        this._click.connect('pressed', (_gesture, _count, x, y) => this._press(x, y));
        this._click.connect('released', (_gesture, _count, x, y) => this._release(x, y));
        this._click.connect('cancel', () => this._cancelGesture());
        this.add_controller(this._click);

        this._motionController = Gtk.EventControllerMotion.new();
        this._motionController.connect('motion', (_controller, x, y) => this._motion(x, y));
        this._motionController.connect('leave', () => {
            if (!this._pointerDown && !this._panning)
                this._setCursorName('default');
        });
        this.add_controller(this._motionController);

        const scroll = Gtk.EventControllerScroll.new(Gtk.EventControllerScrollFlags.VERTICAL);
        scroll.connect('scroll', (_controller, _dx, dy) => {
            const state = scroll.get_current_event_state();
            if (!(state & Gdk.ModifierType.CONTROL_MASK))
                return false;
            const factor = Math.pow(1.15, -clamp(dy, -3, 3));
            this.zoomBy(factor);
            return true;
        });
        this.add_controller(scroll);
    }

    get filePath() {
        return this._filePath;
    }

    get hasImage() {
        return this._pixbuf !== null;
    }

    get hasAnnotations() {
        return this._annotations.length > 0;
    }

    get isDirty() {
        return this._pixbuf !== null && this._revisionId !== this._savedRevisionId;
    }

    get isInteracting() {
        return this._pointerDown || Boolean(this._preview);
    }

    get canUndo() {
        return this._undo.length > 0;
    }

    get canRedo() {
        return this._redo.length > 0;
    }

    get imageSize() {
        if (!this._pixbuf)
            return {width: 0, height: 0};
        return {width: this._crop.width, height: this._crop.height};
    }

    get pendingCrop() {
        return this._pendingCrop;
    }

    get zoomMode() {
        return this._zoomMode;
    }

    get zoomScale() {
        return this._effectiveScale;
    }

    setPanning(active) {
        this._panning = Boolean(active);
        if (this._panning)
            this._setCursorName('grabbing');
        else
            this._setCursorName('default');
    }

    loadFile(path) {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
        this._cancelGesture();
        this._releaseCommittedSurface();
        this._pixbuf = pixbuf;
        this._filePath = path;
        this._annotations = [];
        this._undo = [];
        this._redo = [];
        this._crop = {x: 0, y: 0, width: pixbuf.width, height: pixbuf.height};
        this._pendingCrop = null;
        this._cropHandle = null;
        this._cropOrigin = null;
        this._preview = null;
        this._revisionId = this._nextRevisionId++;
        this._savedRevisionId = this._revisionId;
        this._zoomMode = 'fit';
        this._zoom = 1;
        this._fitScale = 1;
        this._effectiveScale = 1;
        this._syncContentSize();
        this.queue_draw();
        this.emit('file-changed');
        this.emit('history-changed');
        this.emit('pending-crop-changed');
        this.emit('zoom-changed');
    }

    markSaved(path = this._filePath) {
        this._filePath = path;
        this._savedRevisionId = this._revisionId;
        this.emit('file-changed');
    }

    setTool(tool) {
        this._cancelGesture();
        this._tool = tool;
        if (tool !== 'crop')
            this.cancelPendingCrop();
        this.queue_draw();
    }

    setColor(color) {
        this._color = color;
    }

    setStrokeWidth(width) {
        this._strokeWidth = width;
    }

    _minAllowedZoom() {
        return Math.min(BASE_MIN_ZOOM, this._fitScale);
    }

    setZoom(zoom) {
        this._zoomMode = 'manual';
        this._zoom = clamp(zoom, this._minAllowedZoom(), MAX_ZOOM);
        this._effectiveScale = this._zoom;
        this._syncContentSize();
        this.queue_draw();
        this.emit('zoom-changed');
    }

    zoomBy(factor) {
        const base = this._zoomMode === 'fit' ? this._effectiveScale : this._zoom;
        this.setZoom(base * factor);
    }

    fitToWindow() {
        this._zoomMode = 'fit';
        this._zoom = 1;
        this._syncContentSize();
        this.queue_draw();
        this.emit('zoom-changed');
    }

    undo() {
        const state = this._undo.pop();
        if (!state)
            return;
        this._redo.push(this._snapshotState());
        this._restore(state);
    }

    redo() {
        const state = this._redo.pop();
        if (!state)
            return;
        this._undo.push(this._snapshotState());
        this._restore(state);
    }

    clearAnnotations() {
        if (this._annotations.length === 0)
            return false;
        this._pushUndo();
        this._annotations = [];
        this._preview = null;
        this._revisionId = this._nextRevisionId++;
        this.queue_draw();
        this.emit('changed');
        return true;
    }

    applyPendingCrop() {
        if (!validRect(this._pendingCrop))
            return;
        this._pushUndo();
        this._crop = intersection(this._crop, this._pendingCrop);
        this._pendingCrop = null;
        this._cropHandle = null;
        this._revisionId = this._nextRevisionId++;
        this._syncContentSize();
        this.queue_draw();
        this.emit('pending-crop-changed');
        this.emit('zoom-changed');
        this.emit('changed');
    }

    cancelPendingCrop() {
        if (!this._pendingCrop)
            return;
        this._pendingCrop = null;
        this._cropHandle = null;
        this._preview = null;
        this.queue_draw();
        this.emit('pending-crop-changed');
    }

    addText(x, y, text) {
        if (typeof text !== 'string' || !text.trim())
            return;
        this._pushUndo();
        const item = Object.freeze({
            type: 'text',
            x,
            y,
            text,
            color: this._color,
            size: Math.max(18, this._strokeWidth * 5),
        });
        this._annotations = [...this._annotations, item];
        this._revisionId = this._nextRevisionId++;
        this.queue_draw();
        this.emit('changed');
    }

    addAnnotation(annotation) {
        this._pushUndo();
        const frozen = Object.freeze({...annotation});
        this._annotations = [...this._annotations, frozen];
        this._revisionId = this._nextRevisionId++;
        this.queue_draw();
        this.emit('changed');
    }

    setPendingCrop(rect) {
        const clipped = intersection(this._crop, rect);
        this._pendingCrop = validRect(clipped) ? clipped : null;
        this.queue_draw();
        this.emit('pending-crop-changed');
    }

    exportPngBytes() {
        if (!this._pixbuf)
            throw new Error('No image loaded');

        const width = Math.max(1, Math.round(this._crop.width));
        const height = Math.max(1, Math.round(this._crop.height));
        const committed = this._ensureCommittedSurface();

        const snapshot = new Gtk.Snapshot();
        const bounds = new Graphene.Rect();
        bounds.init(0, 0, width, height);
        const context = snapshot.append_cairo(bounds);
        context.setOperator(Cairo.Operator.SOURCE);
        context.setSourceSurface(committed, -this._crop.x, -this._crop.y);
        context.paint();

        const node = snapshot.to_node();
        if (!node)
            throw new Error('Failed to build render node for PNG export');

        const renderer = new Gsk.CairoRenderer();
        renderer.realize(null);
        try {
            const texture = renderer.render_texture(node, bounds);
            return texture.save_to_png_bytes();
        } finally {
            renderer.unrealize();
        }
    }

    exportPng(path, {expectedEtag = null, exclusive = false} = {}) {
        const pngBytes = this.exportPngBytes();
        const data = pngBytes.toArray();
        const file = Gio.File.new_for_path(path);
        const stream = exclusive
            ? file.create(Gio.FileCreateFlags.NONE, null)
            : file.replace(expectedEtag, false, Gio.FileCreateFlags.NONE, null);

        try {
            const [ok, written] = stream.write_all(data, null);
            if (!ok || written !== data.length)
                throw new Error('Incomplete write while saving PNG');
            stream.close(null);
        } catch (error) {
            const abort = new Gio.Cancellable();
            abort.cancel();
            try {
                stream.close(abort);
            } catch (_abortError) {
                // Cancelled close aborts replacement so the previous file stays intact.
            }
            if (exclusive) {
                try {
                    file.delete(null);
                } catch (_deleteError) {
                    // Best-effort cleanup of newly created partial file.
                }
            }
            throw error;
        }

        return {
            path,
            etag: stream.get_etag(),
            width: Math.max(1, Math.round(this._crop.width)),
            height: Math.max(1, Math.round(this._crop.height)),
        };
    }

    _releaseCommittedSurface() {
        if (this._committedSurface) {
            this._committedSurface.finish();
            this._committedSurface = null;
            this._committedSurfaceRevision = -1;
        }
    }

    _ensureCommittedSurface() {
        if (this._committedSurface && this._committedSurfaceRevision === this._revisionId)
            return this._committedSurface;

        this._releaseCommittedSurface();
        const width = this._pixbuf.width;
        const height = this._pixbuf.height;
        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
        const context = new Cairo.Context(surface);

        // Preserve full alpha from source image before drawing annotations.
        context.setOperator(Cairo.Operator.SOURCE);
        Gdk.cairo_set_source_pixbuf(context, this._pixbuf, 0, 0);
        context.paint();
        context.setOperator(Cairo.Operator.OVER);

        for (const annotation of this._annotations)
            this._drawAnnotation(context, annotation, 1, surface);

        this._committedSurface = surface;
        this._committedSurfaceRevision = this._revisionId;
        return surface;
    }

    _syncContentSize() {
        if (!this._pixbuf || this._zoomMode === 'fit') {
            this.set_content_width(0);
            this.set_content_height(0);
            return;
        }
        const drawWidth = Math.ceil(this._crop.width * this._zoom + CANVAS_PADDING * 2);
        const drawHeight = Math.ceil(this._crop.height * this._zoom + CANVAS_PADDING * 2);
        this.set_content_width(drawWidth);
        this.set_content_height(drawHeight);
    }

    _snapshotState() {
        return {
            annotations: this._annotations,
            crop: {...this._crop},
            revisionId: this._revisionId,
        };
    }

    _restore(state) {
        this._cancelGesture();
        this._annotations = state.annotations;
        this._crop = {...state.crop};
        this._revisionId = state.revisionId;
        this._pendingCrop = null;
        this._cropHandle = null;
        this._preview = null;
        this._syncContentSize();
        this.queue_draw();
        this.emit('history-changed');
        this.emit('pending-crop-changed');
        this.emit('zoom-changed');
        this.emit('changed');
    }

    _pushUndo() {
        this._undo.push(this._snapshotState());
        if (this._undo.length > 100)
            this._undo.shift();
        this._redo = [];
        this.emit('history-changed');
    }

    _cancelGesture() {
        if (!this._pointerDown && !this._preview && !this._cropHandle)
            return;
        const restoredCrop = this._cropHandle && this._cropOrigin
            ? {...this._cropOrigin}
            : null;
        this._pointerDown = false;
        this._preview = null;
        this._cropHandle = null;
        this._cropOrigin = null;
        if (restoredCrop) {
            this._pendingCrop = restoredCrop;
            this.emit('pending-crop-changed');
        }
        this.queue_draw();
    }

    _setCursorName(name) {
        if (this._cursorName === name)
            return;
        this._cursorName = name;
        this.set_cursor(Gdk.Cursor.new_from_name(name, null));
    }

    _toImage(x, y, {clampToBounds = false, allowOutside = false} = {}) {
        if (!this._view || !this._crop)
            return null;
        let imageX = (x - this._view.x) / this._view.scale + this._crop.x;
        let imageY = (y - this._view.y) / this._view.scale + this._crop.y;

        const minX = this._crop.x;
        const minY = this._crop.y;
        const maxX = this._crop.x + this._crop.width;
        const maxY = this._crop.y + this._crop.height;

        if (clampToBounds) {
            imageX = clamp(imageX, minX, maxX);
            imageY = clamp(imageY, minY, maxY);
            return {x: imageX, y: imageY};
        }

        if (!allowOutside && (imageX < minX || imageY < minY || imageX > maxX || imageY > maxY))
            return null;
        return {x: imageX, y: imageY};
    }

    _isShiftPressed(controller) {
        const state = controller?.get_current_event_state?.() ?? 0;
        return Boolean(state & Gdk.ModifierType.SHIFT_MASK);
    }

    _applyConstraint(tool, start, point, shiftHeld) {
        if (!shiftHeld)
            return point;
        if (tool === 'rectangle' || tool === 'ellipse')
            return constrainEndPoint(start, point, 'square', this._crop);
        if (tool === 'arrow')
            return constrainEndPoint(start, point, 'angle45', this._crop);
        return point;
    }

    _cropHandleRadius() {
        const scale = this._view?.scale ?? 1;
        return 11 / Math.max(0.05, scale);
    }

    _press(x, y) {
        if (!this._pixbuf || this._panning)
            return;

        if (this._tool === 'crop' && this._pendingCrop) {
            const rawPoint = this._toImage(x, y, {allowOutside: true});
            const handle = rawPoint
                ? cropHandleAt(this._pendingCrop, rawPoint.x, rawPoint.y, this._cropHandleRadius())
                : null;
            if (handle) {
                this.grab_focus();
                this._pointerDown = true;
                this._cropHandle = handle;
                this._start = this._toImage(x, y, {clampToBounds: true});
                this._cropOrigin = {...this._pendingCrop};
                this._setCursorName(handle === 'move' ? 'grabbing' : HANDLE_CURSORS[handle]);
                return;
            }
        }

        const point = this._toImage(x, y);
        if (!point)
            return;
        this.grab_focus();

        if (this._tool === 'text') {
            this._requestText?.(point.x, point.y, x, y,
                text => this.addText(point.x, point.y, text));
            return;
        }
        if (!DRAWING_TOOLS.has(this._tool))
            return;

        this._pointerDown = true;
        this._start = point;
        if (this._tool === 'crop') {
            this._pendingCrop = null;
            this._cropHandle = null;
            this.emit('pending-crop-changed');
        }

        if (this._tool === 'pen' || this._tool === 'highlighter') {
            this._preview = {
                type: this._tool,
                points: [point],
                color: this._color,
                width: this._strokeWidth,
            };
        } else if (this._tool === 'mosaic') {
            this._preview = {
                type: 'mosaic',
                start: point,
                end: point,
                blockSize: MOSAIC_BLOCKS.get(this._strokeWidth) ?? 12,
                color: this._color,
                width: this._strokeWidth,
            };
        } else {
            this._preview = {
                type: this._tool,
                start: point,
                end: point,
                color: this._color,
                width: this._strokeWidth,
            };
        }
        this.queue_draw();
    }

    _motion(x, y) {
        if (!this._pixbuf || this._panning)
            return;

        if (this._pointerDown && this._cropHandle && this._cropOrigin) {
            const point = this._toImage(x, y, {clampToBounds: true});
            const dx = point.x - this._start.x;
            const dy = point.y - this._start.y;
            this._pendingCrop = resizeRectByHandle(
                this._cropOrigin, this._cropHandle, dx, dy, this._crop, 12);
            this.emit('pending-crop-changed');
            this.queue_draw();
            return;
        }

        if (this._pointerDown && this._preview) {
            let point = this._toImage(x, y, {clampToBounds: true});
            if (this._tool === 'pen' || this._tool === 'highlighter') {
                const previous = this._preview.points[this._preview.points.length - 1];
                if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 1.2)
                    this._preview.points.push(point);
            } else {
                point = this._applyConstraint(
                    this._tool, this._preview.start, point,
                    this._isShiftPressed(this._motionController));
                this._preview.end = point;
            }
            this.queue_draw();
            return;
        }

        this._updateHoverCursor(x, y);
    }

    _updateHoverCursor(x, y) {
        if (this._panning)
            return;

        if (this._tool === 'crop' && this._pendingCrop) {
            const rawPoint = this._toImage(x, y, {allowOutside: true});
            const handle = rawPoint
                ? cropHandleAt(this._pendingCrop, rawPoint.x, rawPoint.y, this._cropHandleRadius())
                : null;
            if (handle) {
                this._setCursorName(HANDLE_CURSORS[handle]);
                return;
            }
        }

        const point = this._toImage(x, y);
        if (!point) {
            this._setCursorName('default');
            return;
        }

        if (this._tool === 'text')
            this._setCursorName('text');
        else
            this._setCursorName('crosshair');
    }

    _release(x, y) {
        if (!this._pointerDown)
            return;
        this._pointerDown = false;

        if (this._cropHandle && this._cropOrigin) {
            const point = this._toImage(x, y, {clampToBounds: true});
            if (point) {
                const dx = point.x - this._start.x;
                const dy = point.y - this._start.y;
                this._pendingCrop = resizeRectByHandle(
                    this._cropOrigin, this._cropHandle, dx, dy, this._crop, 12);
                this.emit('pending-crop-changed');
            }
            this._cropHandle = null;
            this._cropOrigin = null;
            this._updateHoverCursor(x, y);
            this.queue_draw();
            return;
        }

        if (!this._preview)
            return;

        let point = this._toImage(x, y, {clampToBounds: true});
        if (point) {
            if (this._preview.points) {
                const previous = this._preview.points[this._preview.points.length - 1];
                if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.5)
                    this._preview.points.push(point);
            } else if (this._preview.end) {
                this._preview.end = this._applyConstraint(
                    this._tool, this._preview.start, point,
                    this._isShiftPressed(this._click));
            }
        }

        if (this._tool === 'crop') {
            const rect = normalizeRect(
                this._preview.start.x, this._preview.start.y,
                this._preview.end.x, this._preview.end.y, this._crop);
            this._pendingCrop = rect.width >= 12 && rect.height >= 12 ? rect : null;
            this._preview = null;
            this.emit('pending-crop-changed');
        } else if (this._isUsefulAnnotation(this._preview)) {
            this._pushUndo();
            const committed = this._preview.points
                ? Object.freeze({...this._preview, points: Object.freeze([...this._preview.points])})
                : Object.freeze({...this._preview});
            this._annotations = [...this._annotations, committed];
            this._preview = null;
            this._revisionId = this._nextRevisionId++;
            this.emit('changed');
        } else {
            this._preview = null;
        }
        this.queue_draw();
    }

    _isUsefulAnnotation(annotation) {
        if (annotation.points)
            return annotation.points.length >= 1;
        if (annotation.type === 'arrow') {
            const dx = annotation.end.x - annotation.start.x;
            const dy = annotation.end.y - annotation.start.y;
            return Math.hypot(dx, dy) >= 2;
        }
        const rect = normalizeRect(
            annotation.start.x, annotation.start.y,
            annotation.end.x, annotation.end.y);
        return validRect(rect);
    }

    _draw(_area, context, width, height) {
        context.setSourceRGB(0.094, 0.094, 0.106);
        context.paint();
        if (!this._pixbuf)
            return;

        // Measure fit scale against the stationary viewport so zooming in never inflates _fitScale.
        let viewport = this.get_parent();
        while (viewport && !(viewport instanceof Gtk.ScrolledWindow))
            viewport = viewport.get_parent();
        const viewW = viewport && viewport.get_width() > 0 ? viewport.get_width() : width;
        const viewH = viewport && viewport.get_height() > 0 ? viewport.get_height() : height;

        const availableW = Math.max(20, viewW - CANVAS_PADDING * 2);
        const availableH = Math.max(20, viewH - CANVAS_PADDING * 2);
        const fitScale = Math.min(availableW / this._crop.width, availableH / this._crop.height, 1.0);
        this._fitScale = Math.max(0.005, fitScale);

        const scale = this._zoomMode === 'fit' ? this._fitScale : this._zoom;
        const scaleChanged = Math.abs(scale - this._effectiveScale) > 0.003;
        this._effectiveScale = scale;
        if (scaleChanged && !this._zoomIdleId) {
            this._zoomIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._zoomIdleId = 0;
                this.emit('zoom-changed');
                return GLib.SOURCE_REMOVE;
            });
        }

        const drawWidth = this._crop.width * scale;
        const drawHeight = this._crop.height * scale;
        const x = Math.round((width - drawWidth) / 2);
        const y = Math.round((height - drawHeight) / 2);
        this._view = {x, y, scale};

        // Subtle shadow behind the screenshot canvas
        context.save();
        context.setSourceRGBA(0, 0, 0, 0.45);
        context.rectangle(x + 4, y + 6, drawWidth, drawHeight);
        context.fill();
        context.restore();

        const committed = this._ensureCommittedSurface();

        context.save();
        context.rectangle(x, y, drawWidth, drawHeight);
        context.clip();
        context.translate(x, y);
        context.scale(scale, scale);
        context.translate(-this._crop.x, -this._crop.y);

        context.setSourceSurface(committed, 0, 0);
        if (scale > 2)
            context.getSource().setFilter(Cairo.Filter.NEAREST);
        context.paint();

        if (this._preview)
            this._drawAnnotation(context, this._preview, scale, committed);
        if (this._pendingCrop)
            this._drawCrop(context, this._pendingCrop, scale, true);
        context.restore();

        // Crisp 1px hair-border around canvas so dark screenshots stay clearly framed
        context.save();
        context.setSourceRGBA(1, 1, 1, 0.14);
        context.setLineWidth(1);
        context.rectangle(x - 0.5, y - 0.5, drawWidth + 1, drawHeight + 1);
        context.stroke();
        context.restore();
    }

    _drawSmoothStroke(context, points) {
        context.moveTo(points[0].x, points[0].y);
        if (points.length === 2) {
            context.lineTo(points[1].x, points[1].y);
            return;
        }
        for (let i = 1; i < points.length - 1; i++) {
            const midX = (points[i].x + points[i + 1].x) / 2;
            const midY = (points[i].y + points[i + 1].y) / 2;
            context.curveTo(
                points[i].x, points[i].y,
                points[i].x, points[i].y,
                midX, midY);
        }
        const last = points[points.length - 1];
        context.lineTo(last.x, last.y);
    }

    _drawAnnotation(context, annotation, viewScale, sourceSurface) {
        if (annotation.type === 'pen' || annotation.type === 'highlighter') {
            const [red, green, blue, alpha] = rgba(
                annotation.color, annotation.type === 'highlighter' ? 0.36 : 1);
            const lineWidth = annotation.type === 'highlighter'
                ? annotation.width * 4
                : annotation.width;
            context.save();
            context.setSourceRGBA(red, green, blue, alpha);
            if (annotation.points.length === 1) {
                const pt = annotation.points[0];
                context.arc(pt.x, pt.y, lineWidth / 2, 0, Math.PI * 2);
                context.fill();
            } else {
                context.setLineWidth(lineWidth);
                context.setLineCap(Cairo.LineCap.ROUND);
                context.setLineJoin(Cairo.LineJoin.ROUND);
                this._drawSmoothStroke(context, annotation.points);
                context.stroke();
            }
            context.restore();
            return;
        }

        if (annotation.type === 'text') {
            this._drawText(context, annotation);
            return;
        }

        const rect = normalizeRect(
            annotation.start.x, annotation.start.y,
            annotation.end.x, annotation.end.y);
        if (annotation.type === 'mosaic') {
            if (sourceSurface) {
                drawMosaicFromSurface(
                    sourceSurface, context, rect,
                    annotation.blockSize ?? 12,
                    this._pixbuf.width, this._pixbuf.height
                );
            }
            return;
        }
        if (annotation.type === 'crop') {
            this._drawCrop(context, rect, viewScale, false);
            return;
        }

        const [red, green, blue] = rgba(annotation.color);
        context.save();
        context.setSourceRGB(red, green, blue);
        context.setLineWidth(annotation.width);
        context.setLineCap(Cairo.LineCap.ROUND);
        context.setLineJoin(Cairo.LineJoin.ROUND);

        if (annotation.type === 'rectangle') {
            if (validRect(rect)) {
                context.rectangle(rect.x, rect.y, rect.width, rect.height);
                context.stroke();
            }
        } else if (annotation.type === 'ellipse') {
            if (validRect(rect)) {
                context.save();
                context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
                context.scale(rect.width / 2, rect.height / 2);
                context.arc(0, 0, 1, 0, Math.PI * 2);
                context.restore();
                context.stroke();
            }
        } else if (annotation.type === 'arrow') {
            const dx = annotation.end.x - annotation.start.x;
            const dy = annotation.end.y - annotation.start.y;
            const length = Math.hypot(dx, dy);
            if (length >= 2) {
                const angle = Math.atan2(dy, dx);
                const head = Math.min(length * 0.75, Math.max(14, annotation.width * 4.2));
                const shaftEndX = annotation.end.x - head * 0.72 * Math.cos(angle);
                const shaftEndY = annotation.end.y - head * 0.72 * Math.sin(angle);

                context.moveTo(annotation.start.x, annotation.start.y);
                context.lineTo(shaftEndX, shaftEndY);
                context.stroke();

                context.moveTo(annotation.end.x, annotation.end.y);
                context.lineTo(
                    annotation.end.x - head * Math.cos(angle - Math.PI / 6.5),
                    annotation.end.y - head * Math.sin(angle - Math.PI / 6.5));
                context.lineTo(
                    annotation.end.x - head * 0.72 * Math.cos(angle),
                    annotation.end.y - head * 0.72 * Math.sin(angle));
                context.lineTo(
                    annotation.end.x - head * Math.cos(angle + Math.PI / 6.5),
                    annotation.end.y - head * Math.sin(angle + Math.PI / 6.5));
                context.closePath();
                context.fill();
            }
        }
        context.restore();
    }

    _drawText(context, annotation) {
        const [red, green, blue] = rgba(annotation.color);
        const layout = PangoCairo.create_layout(context);
        const font = Pango.FontDescription.from_string('Sans Bold');
        font.set_absolute_size(annotation.size * Pango.SCALE);
        layout.set_font_description(font);
        layout.set_spacing(Math.round(annotation.size * 0.2 * Pango.SCALE));
        layout.set_text(annotation.text, -1);

        const isDark = luminance(red, green, blue) < 0.32;
        const haloWidth = Math.max(2.5, annotation.size * 0.14);

        context.save();
        context.moveTo(annotation.x, annotation.y);
        PangoCairo.layout_path(context, layout);

        // Contrasting halo ensures crisp legibility over both light and dark screenshots.
        context.setLineJoin(Cairo.LineJoin.ROUND);
        context.setLineWidth(haloWidth);
        if (isDark)
            context.setSourceRGBA(1, 1, 1, 0.85);
        else
            context.setSourceRGBA(0, 0, 0, 0.72);
        context.strokePreserve();

        context.setSourceRGB(red, green, blue);
        context.fill();
        context.restore();
    }

    _drawCrop(context, rect, viewScale, showHandles) {
        const invScale = 1 / Math.max(0.05, viewScale);

        context.save();
        context.setSourceRGBA(0, 0, 0, 0.56);
        context.rectangle(this._crop.x, this._crop.y, this._crop.width, this._crop.height);
        context.rectangle(rect.x, rect.y, rect.width, rect.height);
        context.setFillRule(Cairo.FillRule.EVEN_ODD);
        context.fill();

        // Subtle rule-of-thirds guides inside crop area
        if (rect.width * viewScale >= 60 && rect.height * viewScale >= 60) {
            context.setSourceRGBA(1, 1, 1, 0.26);
            context.setLineWidth(1 * invScale);
            for (let i = 1; i <= 2; i++) {
                const gx = rect.x + (rect.width * i) / 3;
                const gy = rect.y + (rect.height * i) / 3;
                context.moveTo(gx, rect.y);
                context.lineTo(gx, rect.y + rect.height);
                context.moveTo(rect.x, gy);
                context.lineTo(rect.x + rect.width, gy);
            }
            context.stroke();
        }

        // Crisp accent crop border
        context.setSourceRGB(0.29, 0.76, 1);
        context.setLineWidth(2 * invScale);
        context.rectangle(rect.x, rect.y, rect.width, rect.height);
        context.stroke();

        // Interactive resize handles
        if (showHandles) {
            const handleSize = 9 * invScale;
            const half = handleSize / 2;
            const left = rect.x;
            const right = rect.x + rect.width;
            const top = rect.y;
            const bottom = rect.y + rect.height;
            const midX = left + rect.width / 2;
            const midY = top + rect.height / 2;
            const positions = [
                [left, top], [right, top], [left, bottom], [right, bottom],
                [midX, top], [midX, bottom], [left, midY], [right, midY],
            ];
            for (const [hx, hy] of positions) {
                context.setSourceRGB(1, 1, 1);
                context.rectangle(hx - half, hy - half, handleSize, handleSize);
                context.fillPreserve();
                context.setSourceRGB(0.08, 0.50, 0.85);
                context.setLineWidth(1.5 * invScale);
                context.stroke();
            }
        }

        // Dimensions pill inside/above crop selection
        if (rect.width >= 20 && rect.height >= 20) {
            const label = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
            const layout = PangoCairo.create_layout(context);
            const font = Pango.FontDescription.from_string('Sans Bold');
            font.set_absolute_size(12 * invScale * Pango.SCALE);
            layout.set_font_description(font);
            layout.set_text(label, -1);
            const [textW, textH] = layout.get_pixel_size();
            const padX = 8 * invScale;
            const padY = 4 * invScale;
            const pillW = textW + padX * 2;
            const pillH = textH + padY * 2;
            const pillX = clamp(rect.x + 8 * invScale, this._crop.x,
                Math.max(this._crop.x, this._crop.x + this._crop.width - pillW));
            const pillY = rect.y - pillH - 8 * invScale >= this._crop.y
                ? rect.y - pillH - 8 * invScale
                : rect.y + 8 * invScale;

            context.setSourceRGBA(0.08, 0.08, 0.10, 0.88);
            drawRoundedRect(context, pillX, pillY, pillW, pillH, 5 * invScale);
            context.fill();

            context.setSourceRGB(1, 1, 1);
            context.moveTo(pillX + padX, pillY + padY);
            PangoCairo.show_layout(context, layout);
        }

        context.restore();
    }
});
