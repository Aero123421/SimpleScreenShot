// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    clamp,
    clampCaptureGeometry,
    intersection,
    normalizeRectFloat,
    rectForPoint,
} from './geometry.js';
import {t} from './i18n.js';

const MODES = ['region', 'window', 'screen'];

function modeIcon(mode) {
    return {
        region: 'selection-mode-symbolic',
        window: 'focus-windows-symbolic',
        screen: 'view-fullscreen-symbolic',
    }[mode];
}

function modeShortcut(mode) {
    return {
        region: 'R',
        window: 'W',
        screen: 'F',
    }[mode];
}

function truncateText(text, maxLength = 38) {
    if (!text)
        return '';
    const trimmed = text.trim();
    if (trimmed.length <= maxLength)
        return trimmed;
    return `${trimmed.slice(0, maxLength - 1)}…`;
}

export const SnippingOverlay = GObject.registerClass(
class SnippingOverlay extends St.Widget {
    _init(params = {}) {
        super._init({
            name: 'simple-screenshot-overlay',
            reactive: true,
            can_focus: true,
            track_hover: true,
            layout_manager: new Clutter.FixedLayout(),
        });

        this._onCapture = params.onCapture;
        this._onCancel = params.onCancel;
        this._onSettings = params.onSettings;
        this._includePointer = Boolean(params.includePointer);
        this._mode = MODES.includes(params.initialMode)
            ? params.initialMode
            : 'region';
        this._dragging = false;
        this._start = null;
        this._currentTarget = null;
        this._windowEntries = [];
        this._monitorRects = [];
        this._activeMonitor = null;
        this._grab = null;
        this._cursor = null;
        this._monitorsChangedId = 0;

        this._background = new St.Widget();
        this.add_child(this._background);

        this._frozenCursor = new St.Widget({visible: false});
        this.add_child(this._frozenCursor);

        this._fullShade = new St.Widget({
            style_class: 'simple-screenshot-shade',
        });
        this.add_child(this._fullShade);

        this._shades = Array.from({length: 4}, () => {
            const shade = new St.Widget({
                style_class: 'simple-screenshot-shade',
                visible: false,
            });
            this.add_child(shade);
            return shade;
        });

        this._selection = new St.Widget({
            style_class: 'simple-screenshot-selection',
            visible: false,
        });
        this.add_child(this._selection);

        this._sizeLabel = new St.Label({
            style_class: 'simple-screenshot-size-label',
            visible: false,
        });
        this.add_child(this._sizeLabel);

        // Explicitly sized inside FixedLayout so toolbar and hint never span across bezels.
        this._chrome = new St.Widget({
            x_expand: false,
            y_expand: false,
            layout_manager: new Clutter.BinLayout(),
        });
        this.add_child(this._chrome);

        this._toolbar = this._buildToolbar();
        this._toolbarHost = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.START,
        });
        this._toolbarHost.add_child(this._toolbar);
        this._chrome.add_child(this._toolbarHost);

        this._hint = new St.Label({
            style_class: 'simple-screenshot-hint',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true,
        });
        this._chrome.add_child(this._hint);

        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('motion-event', this._onMotion.bind(this));
        this.connect('button-release-event', this._onButtonRelease.bind(this));
        this.connect('key-press-event', this._onKeyPress.bind(this));
        this.connect('destroy', () => this._releaseModal());
        this._syncMode();
    }

    _buildToolbar() {
        const box = new St.BoxLayout({
            style_class: 'simple-screenshot-toolbar',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            reactive: true,
        });
        this._modeButtons = new Map();

        for (const mode of MODES) {
            const child = new St.BoxLayout({
                style_class: 'simple-screenshot-tool-content',
                vertical: true,
            });
            child.add_child(new St.Icon({
                icon_name: modeIcon(mode),
                style_class: 'simple-screenshot-tool-icon',
            }));
            child.add_child(new St.Label({
                text: `${t(mode)} (${modeShortcut(mode)})`,
                style_class: 'simple-screenshot-tool-label',
            }));

            const button = new St.Button({
                style_class: 'simple-screenshot-tool-button',
                child,
                can_focus: true,
                accessible_name: t(mode),
            });
            button.connect('clicked', () => {
                if (!this._dragging)
                    this.setMode(mode);
            });
            box.add_child(button);
            this._modeButtons.set(mode, button);
        }

        box.add_child(new St.Widget({style_class: 'simple-screenshot-divider'}));
        box.add_child(this._iconButton(
            'preferences-system-symbolic', t('settings'), () => {
                if (this._dragging)
                    return;
                const callback = this._onSettings;
                this._close();
                callback?.();
            }));
        box.add_child(this._iconButton(
            'window-close-symbolic', t('cancel'), () => this.cancel()));
        return box;
    }

    _iconButton(iconName, accessibleName, callback) {
        const button = new St.Button({
            style_class: 'simple-screenshot-icon-button',
            child: new St.Icon({
                icon_name: iconName,
                style_class: 'simple-screenshot-action-icon',
            }),
            can_focus: true,
            accessible_name: accessibleName,
        });
        button.connect('clicked', callback);
        return button;
    }

    open(snapshot) {
        try {
            this._snapshot = snapshot;

            const stageBounds = {
                x: 0,
                y: 0,
                width: global.stage.width,
                height: global.stage.height,
            };
            this._background.set_content(snapshot.content);
            this._background.set_position(0, 0);
            this._background.set_size(stageBounds.width, stageBounds.height);
            this._fullShade.set_position(0, 0);
            this._fullShade.set_size(stageBounds.width, stageBounds.height);

            if (this._includePointer && snapshot.cursorContent && snapshot.cursorPoint) {
                const [, width, height] = snapshot.cursorContent.get_preferred_size();
                const cursorScale = snapshot.cursorScale ?? 1;
                this._frozenCursor.set_content(snapshot.cursorContent);
                this._frozenCursor.set_position(snapshot.cursorPoint.x, snapshot.cursorPoint.y);
                this._frozenCursor.set_size(width * cursorScale, height * cursorScale);
                this._frozenCursor.show();
            }

            this._monitorRects = Main.layoutManager.monitors.map(monitor => ({
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
            }));

            // Capture individual window contents once while the desktop is frozen so
            // occluded windows never leak overlapping application pixels.
            this._windowEntries = global.get_window_actors()
                .filter(actor => actor.visible)
                .map(actor => {
                    const window = actor.meta_window;
                    if (!window ||
                        !window.showing_on_its_workspace() ||
                        window.is_override_redirect() ||
                        window.get_window_type() === Meta.WindowType.DESKTOP ||
                        window.get_window_type() === Meta.WindowType.DOCK)
                        return null;

                    const frame = window.get_frame_rect();
                    const clipped = intersection({
                        x: frame.x,
                        y: frame.y,
                        width: frame.width,
                        height: frame.height,
                    }, stageBounds);
                    if (clipped.width < 4 || clipped.height < 4)
                        return null;

                    let windowContent = null;
                    try {
                        windowContent = actor.paint_to_content(null);
                    } catch (_error) {
                        windowContent = null;
                    }
                    const texture = windowContent?.get_texture() ?? null;
                    if (!texture)
                        return null;
                    const buffer = window.get_buffer_rect();
                    return {
                        ...clipped,
                        title: window.get_title() ?? '',
                        windowContent,
                        texture,
                        ownsCursor: false,
                        bufferScale: actor.get_resource_scale?.() ?? snapshot.scale,
                        bufferRect: {
                            x: buffer.x,
                            y: buffer.y,
                            width: buffer.width,
                            height: buffer.height,
                        },
                    };
                })
                .filter(Boolean)
                .reverse();

            // Only the top-most window under the frozen pointer owns the cursor sprite.
            if (snapshot.cursorPoint) {
                const cursorOwner = rectForPoint(
                    this._windowEntries,
                    snapshot.cursorPoint.x,
                    snapshot.cursorPoint.y
                );
                if (cursorOwner)
                    cursorOwner.ownsCursor = true;
            }

            const [pointerX, pointerY] = global.get_pointer();
            this._activeMonitor = rectForPoint(this._monitorRects, pointerX, pointerY) ??
                Main.layoutManager.primaryMonitor ??
                stageBounds;

            Main.layoutManager.emit('system-modal-opened');
            Main.layoutManager.addTopChrome(this, {trackFullscreen: false});
            this.set_position(0, 0);
            this.set_size(stageBounds.width, stageBounds.height);
            this._chrome.set_position(this._activeMonitor.x, this._activeMonitor.y);
            this._chrome.set_size(this._activeMonitor.width, this._activeMonitor.height);

            this._grab = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
            if (!this._grab ||
                (this._grab.get_seat_state() & Clutter.GrabState.ALL) !== Clutter.GrabState.ALL)
                throw new Error('Could not acquire full input grab for screenshot overlay');

            this._monitorsChangedId = Main.layoutManager.connect(
                'monitors-changed', () => this.cancel());

            this.grab_key_focus();

            // Keep frozen screen opaque immediately; animate only the UI chrome and shade.
            this._fullShade.opacity = 0;
            this._chrome.opacity = 0;
            this._fullShade.ease({
                opacity: 255,
                duration: 110,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            this._chrome.ease({
                opacity: 255,
                duration: 130,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            this._syncHoverTarget(pointerX, pointerY);
            this._updateCursor(false);
        } catch (error) {
            this._close();
            throw error;
        }
    }

    setMode(mode) {
        if (!MODES.includes(mode))
            return;
        this._mode = mode;
        this._dragging = false;
        this._chrome.show();
        this._resetSelection();
        this._syncMode();
        const [x, y] = global.get_pointer();
        this._syncHoverTarget(x, y);
        this._updateCursor(false);
        this.grab_key_focus();
    }

    _syncMode() {
        for (const [mode, button] of this._modeButtons) {
            if (mode === this._mode)
                button.add_style_pseudo_class('checked');
            else
                button.remove_style_pseudo_class('checked');
        }

        this._hint.text = {
            region: t('regionHint'),
            window: t('windowHint'),
            screen: t('screenHint'),
        }[this._mode];
    }

    _isOverToolbar(event) {
        const actor = global.stage.get_event_actor(event);
        return Boolean(actor && (actor === this._toolbar || this._toolbar.contains(actor)));
    }

    _setCursor(cursor) {
        if (this._cursor === cursor)
            return;
        this._cursor = cursor;
        global.display.set_cursor(cursor);
    }

    _updateCursor(overToolbar) {
        if (overToolbar) {
            this._setCursor(Meta.Cursor.DEFAULT);
            return;
        }
        if (this._mode === 'region')
            this._setCursor(Meta.Cursor.CROSSHAIR);
        else if (this._currentTarget)
            this._setCursor(Meta.Cursor.POINTING_HAND);
        else
            this._setCursor(Meta.Cursor.DEFAULT);
    }

    _targetAtPoint(x, y) {
        if (this._mode === 'window')
            return rectForPoint(this._windowEntries, x, y);
        if (this._mode === 'screen')
            return rectForPoint(this._monitorRects, x, y);
        return null;
    }

    _onButtonPress(_actor, event) {
        const button = event.get_button();
        if (button === Clutter.BUTTON_SECONDARY) {
            if (this._dragging) {
                this._dragging = false;
                this._chrome.show();
                this._resetSelection();
                this._updateCursor(false);
            } else {
                this.cancel();
            }
            return Clutter.EVENT_STOP;
        }

        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        if (this._isOverToolbar(event))
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        if (this._mode === 'region') {
            this._dragging = true;
            this._start = {x, y};
            this._chrome.hide();
            this._showTarget({x, y, width: 1, height: 1}, true);
        } else {
            const target = this._targetAtPoint(x, y);
            if (target)
                this._requestCapture(target);
        }
        return Clutter.EVENT_STOP;
    }

    _onMotion(_actor, event) {
        const [x, y] = event.get_coords();
        const overToolbar = !this._dragging && this._isOverToolbar(event);

        if (this._mode === 'region' && this._dragging) {
            const rect = normalizeRectFloat(
                this._start.x, this._start.y, x, y,
                {x: 0, y: 0, width: this.width, height: this.height});
            this._showTarget(rect, true);
        } else if (this._mode !== 'region' && !overToolbar) {
            this._syncHoverTarget(x, y);
        }

        this._updateCursor(overToolbar);
        return Clutter.EVENT_STOP;
    }

    _onButtonRelease(_actor, event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY || !this._dragging)
            return Clutter.EVENT_PROPAGATE;

        this._dragging = false;
        const [x, y] = event.get_coords();
        const rect = normalizeRectFloat(
            this._start.x, this._start.y, x, y,
            {x: 0, y: 0, width: this.width, height: this.height});
        const scaled = clampCaptureGeometry(
            rect,
            this._snapshot.scale,
            this._snapshot.texture.get_width(),
            this._snapshot.texture.get_height()
        );
        if (scaled && rect.width >= 4 && rect.height >= 4) {
            this._requestCapture(rect);
        } else {
            this._chrome.show();
            this._resetSelection();
            this._updateCursor(false);
        }
        return Clutter.EVENT_STOP;
    }

    _onKeyPress(_actor, event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            if (this._dragging) {
                this._dragging = false;
                this._chrome.show();
                this._resetSelection();
                this._updateCursor(false);
            } else {
                this.cancel();
            }
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_r || symbol === Clutter.KEY_R || symbol === Clutter.KEY_1)
            this.setMode('region');
        else if (symbol === Clutter.KEY_w || symbol === Clutter.KEY_W || symbol === Clutter.KEY_2)
            this.setMode('window');
        else if (symbol === Clutter.KEY_f || symbol === Clutter.KEY_F || symbol === Clutter.KEY_3)
            this.setMode('screen');
        else if ((symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_space) && this._mode !== 'region' && this._currentTarget)
            this._requestCapture(this._currentTarget);
        else
            return Clutter.EVENT_PROPAGATE;
        return Clutter.EVENT_STOP;
    }

    _syncHoverTarget(x, y) {
        const target = this._targetAtPoint(x, y);
        if (target)
            this._showTarget(target, true);
        else
            this._resetSelection();
    }

    _pixelDimensionsForTarget(target) {
        if (this._mode === 'window' && target.texture) {
            return {
                width: target.texture.get_width(),
                height: target.texture.get_height(),
            };
        }
        const scaled = clampCaptureGeometry(
            target,
            this._snapshot.scale,
            this._snapshot.texture.get_width(),
            this._snapshot.texture.get_height()
        );
        if (scaled)
            return {width: scaled[2], height: scaled[3]};
        return {width: Math.round(target.width), height: Math.round(target.height)};
    }

    _showTarget(target, showBadge) {
        this._currentTarget = target;
        const left = Math.round(target.x);
        const top = Math.round(target.y);
        const right = Math.round(target.x + target.width);
        const bottom = Math.round(target.y + target.height);
        const width = Math.max(1, right - left);
        const height = Math.max(1, bottom - top);

        this._fullShade.hide();
        this._shades.forEach(shade => shade.show());
        this._selection.show();
        this._selection.set_position(left, top);
        this._selection.set_size(width, height);

        const [topShade, bottomShade, leftShade, rightShade] = this._shades;
        topShade.set_position(0, 0);
        topShade.set_size(this.width, top);
        bottomShade.set_position(0, bottom);
        bottomShade.set_size(this.width, Math.max(0, this.height - bottom));
        leftShade.set_position(0, top);
        leftShade.set_size(left, height);
        rightShade.set_position(right, top);
        rightShade.set_size(Math.max(0, this.width - right), height);

        if (showBadge && width > 24 && height > 24) {
            const px = this._pixelDimensionsForTarget(target);
            const dims = `${px.width} × ${px.height} px`;
            const title = this._mode === 'window' ? truncateText(target.title) : '';
            this._sizeLabel.text = title ? `${title}  •  ${dims}` : dims;
            this._sizeLabel.show();

            const monitor = rectForPoint(
                this._monitorRects,
                left + width / 2,
                top + height / 2
            ) ?? this._activeMonitor ?? {x: 0, y: 0, width: this.width, height: this.height};

            const [, naturalWidth] = this._sizeLabel.get_preferred_width(-1);
            const [, naturalHeight] = this._sizeLabel.get_preferred_height(-1);
            const badgeW = Math.max(88, Math.ceil(naturalWidth));
            const badgeH = Math.max(28, Math.ceil(naturalHeight));
            const margin = 10;

            const minX = monitor.x + margin;
            const maxX = Math.max(minX, monitor.x + monitor.width - badgeW - margin);
            const labelX = clamp(left, minX, maxX);

            let labelY;
            if (bottom + badgeH + 12 <= monitor.y + monitor.height - 64)
                labelY = bottom + 8;
            else if (top - badgeH - 12 >= monitor.y + 84)
                labelY = top - badgeH - 8;
            else
                labelY = clamp(top + 10, monitor.y + margin, monitor.y + monitor.height - badgeH - margin);

            this._sizeLabel.set_position(labelX, labelY);
        } else {
            this._sizeLabel.hide();
        }
    }

    _resetSelection() {
        this._currentTarget = null;
        this._selection.hide();
        this._sizeLabel.hide();
        this._fullShade.show();
        this._shades.forEach(shade => shade.hide());
    }

    _requestCapture(target) {
        const snapshot = this._snapshot;
        const payload = {
            mode: this._mode,
            rect: {
                x: target.x,
                y: target.y,
                width: target.width,
                height: target.height,
            },
            windowTarget: this._mode === 'window' ? target : null,
            includePointer: this._includePointer,
        };
        this._close();
        this._onCapture?.(snapshot, payload);
    }

    cancel() {
        this._close();
        this._onCancel?.();
    }

    _close() {
        this._releaseModal();
        this.destroy();
    }

    _releaseModal() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._cursor !== null) {
            this._cursor = null;
            global.display.set_cursor(Meta.Cursor.DEFAULT);
        }
        if (!this._grab)
            return;
        Main.popModal(this._grab);
        this._grab = null;
    }
});
