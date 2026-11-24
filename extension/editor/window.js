// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';

import {suggestedPngName} from '../geometry.js';
import {ScreenshotCanvas} from './canvas.js';
import {HistoryStore} from './history.js';
import {t} from './i18n.js';

const TOOLS = [
    ['pen', 'ss-pen-symbolic'],
    ['highlighter', 'ss-highlighter-symbolic'],
    ['arrow', 'ss-arrow-symbolic'],
    ['rectangle', 'ss-rectangle-symbolic'],
    ['ellipse', 'ss-ellipse-symbolic'],
    ['text', 'ss-text-symbolic'],
    ['mosaic', 'ss-mosaic-symbolic'],
    ['crop', 'ss-crop-symbolic'],
];

const SWATCHES = [
    ['#ff3b30', 'swatch-red', 'colorRed'],
    ['#ffd60a', 'swatch-yellow', 'colorYellow'],
    ['#34c759', 'swatch-green', 'colorGreen'],
    ['#0a84ff', 'swatch-blue', 'colorBlue'],
    ['#f8f8fa', 'swatch-white', 'colorWhite'],
    ['#1c1c1e', 'swatch-black', 'colorBlack'],
];

const SIZES = [
    [2, 8, 'sizeThin'],
    [4, 12, 'sizeMedium'],
    [8, 18, 'sizeThick'],
    [14, 26, 'sizeExtra'],
];

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

function isDismissedError(error) {
    return error instanceof GLib.Error &&
        error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED);
}

function isConflictError(error) {
    return error instanceof GLib.Error && (
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.WRONG_ETAG) ||
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)
    );
}

function isNotFoundError(error) {
    return error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
}

function hexToRgb(hex) {
    const value = hex.replace('#', '');
    return [
        Number.parseInt(value.slice(0, 2), 16) / 255,
        Number.parseInt(value.slice(2, 4), 16) / 255,
        Number.parseInt(value.slice(4, 6), 16) / 255,
    ];
}

function colorToHex(color) {
    const channel = value => Math.round(value * 255)
        .toString(16).padStart(2, '0');
    return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function runtimeCaptureDirPrefix() {
    const dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'simple-screenshot']);
    return dir.endsWith('/') ? dir : `${dir}/`;
}

function defaultScreenshotsFolder() {
    const pictures = GLib.get_user_special_dir(
        GLib.UserDirectory.DIRECTORY_PICTURES) ?? GLib.get_home_dir();
    const screenshots = Gio.File.new_for_path(
        GLib.build_filenamev([pictures, 'Screenshots']));
    if (screenshots.query_exists(null))
        return screenshots;
    return Gio.File.new_for_path(pictures);
}

function queryFileEtag(path) {
    try {
        const info = Gio.File.new_for_path(path).query_info(
            'etag::value', Gio.FileQueryInfoFlags.NONE, null);
        return info.get_etag();
    } catch (_error) {
        return null;
    }
}

function formatRelativeTime(isoString) {
    if (!isoString)
        return '';
    const parsed = GLib.DateTime.new_from_iso8601(isoString, null);
    if (!parsed)
        return '';
    const now = GLib.DateTime.new_now_local();
    const diffSeconds = Math.max(0, Math.floor(now.difference(parsed) / 1_000_000));
    if (diffSeconds < 60)
        return t('justNow');
    if (diffSeconds < 3600)
        return t('minutesAgo', {n: Math.floor(diffSeconds / 60)});
    if (diffSeconds < 86400)
        return t('hoursAgo', {n: Math.floor(diffSeconds / 3600)});
    if (diffSeconds < 172800)
        return t('yesterday');
    return parsed.format('%Y-%m-%d');
}

function showInFileManager(path, parentWindow) {
    const file = Gio.File.new_for_path(path);
    const fallback = () => {
        const launcher = new Gtk.FileLauncher({file: file.get_parent()});
        launcher.launch(parentWindow, null, null);
    };
    try {
        Gio.DBus.session.call(
            'org.freedesktop.FileManager1',
            '/org/freedesktop/FileManager1',
            'org.freedesktop.FileManager1',
            'ShowItems',
            new GLib.Variant('(ass)', [[file.get_uri()], '']),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (_connection, result) => {
                try {
                    Gio.DBus.session.call_finish(result);
                } catch (_error) {
                    fallback();
                }
            }
        );
    } catch (_error) {
        fallback();
    }
}

export const EditorWindow = GObject.registerClass(
class EditorWindow extends Adw.ApplicationWindow {
    _init(application, inputPath = null) {
        super._init({
            application,
            title: t('appName'),
            default_width: 1260,
            default_height: 820,
            width_request: 680,
            height_request: 520,
        });

        this._historyStore = new HistoryStore();
        this._forceClosing = false;
        this._syncingColor = false;
        this._currentColor = '#ff3b30';
        this._currentTool = 'pen';
        this._fileEtag = null;
        this._isTemporary = false;
        this._isPngFormat = false;
        this._textPopover = null;
        this._historyRows = [];
        this._historyEntries = [];
        this._knownDimensions = new Map();
        this._historyLoadToken = 0;

        this._registerWindowActions();
        this._buildUi();
        this._setupDropTarget();

        const entries = this._loadHistory();
        const initial = inputPath ??
            entries.find(entry => Gio.File.new_for_path(entry.path).query_exists(null))?.path ??
            null;
        if (initial)
            this._loadFile(initial);
        this._syncActions();

        this.connect('close-request', () => {
            if (!this._hasUnsavedWork() || this._forceClosing)
                return false;
            this._confirmDiscard(() => {
                this._forceClosing = true;
                this.close();
            });
            return true;
        });

        this.connect('destroy', () => {
            this._historyLoadToken++;
            this._dismissTextPopover();
        });
    }

    _registerWindowActions() {
        this._saveAsAction = new Gio.SimpleAction({name: 'save-as'});
        this._saveAsAction.connect('activate', () => {
            this._saveAs();
        });
        this.add_action(this._saveAsAction);

        this._showFilesAction = new Gio.SimpleAction({name: 'show-in-files'});
        this._showFilesAction.connect('activate', () => {
            if (this._canvas.filePath)
                showInFileManager(this._canvas.filePath, this);
        });
        this.add_action(this._showFilesAction);

        const openAction = new Gio.SimpleAction({name: 'open-image'});
        openAction.connect('activate', () => this._openImageDialog());
        this.add_action(openAction);
    }

    _buildUi() {
        this._splitView = new Adw.OverlaySplitView({
            show_sidebar: true,
            sidebar_width_fraction: 0.23,
            min_sidebar_width: 232,
            max_sidebar_width: 280,
        });
        this.content = this._splitView;

        const breakpoint = Adw.Breakpoint.new(
            Adw.BreakpointCondition.parse('max-width: 980sp'));
        breakpoint.add_setter(this._splitView, 'collapsed', true);
        this.add_breakpoint(breakpoint);

        this._splitView.sidebar = this._buildSidebar();
        this._splitView.content = this._buildMainContent();
        this._setupKeyboardShortcuts();
        this._syncCropActions();
        this._syncZoomLabel();
    }

    _buildSidebar() {
        const sidebarView = new Adw.ToolbarView({
            css_classes: ['history-sidebar'],
        });

        const sidebarHeader = new Adw.HeaderBar({
            show_start_title_buttons: false,
            show_end_title_buttons: false,
            title_widget: new Gtk.Label({
                label: t('history'),
                css_classes: ['heading'],
            }),
        });
        sidebarHeader.pack_start(this._iconButton(
            'document-open-symbolic', t('openImage'), () => this._openImageDialog()));
        sidebarHeader.pack_end(this._iconButton(
            'view-refresh-symbolic', t('refreshHistory'), () => this._loadHistory()));
        sidebarView.add_top_bar(sidebarHeader);

        this._historyList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['history-list'],
        });
        this._historyList.connect('row-activated', (_list, row) => {
            if (row.capturePath && row.capturePath !== this._canvas.filePath)
                this._requestOpenFile(row.capturePath);
        });

        const historyScroll = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vexpand: true,
            child: this._historyList,
        });
        sidebarView.content = historyScroll;
        return sidebarView;
    }

    _buildMainContent() {
        const mainView = new Adw.ToolbarView();

        const header = new Adw.HeaderBar();
        this._windowTitle = new Adw.WindowTitle({
            title: t('appName'),
            subtitle: '',
        });
        header.title_widget = this._windowTitle;

        const sidebarToggle = new Gtk.ToggleButton({
            icon_name: 'sidebar-show-symbolic',
            tooltip_text: t('history'),
            active: true,
        });
        this._splitView.bind_property(
            'show-sidebar', sidebarToggle, 'active',
            GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);
        header.pack_start(sidebarToggle);

        this._undoButton = this._iconButton('edit-undo-symbolic', t('undo'), () =>
            this._canvas.undo());
        this._redoButton = this._iconButton('edit-redo-symbolic', t('redo'), () =>
            this._canvas.redo());
        this._clearButton = this._iconButton('edit-clear-symbolic', t('clearAnnotations'), () => {
            if (this._canvas.clearAnnotations())
                this._toast(t('clearedToast'));
        });
        header.pack_start(this._undoButton);
        header.pack_start(this._redoButton);
        header.pack_start(this._clearButton);

        // Primary menu exposes clearly labeled secondary file operations instead of ambiguous icons.
        const menuModel = new Gio.Menu();
        menuModel.append(t('saveAs'), 'win.save-as');
        menuModel.append(t('showInFiles'), 'win.show-in-files');
        menuModel.append(t('openImage'), 'win.open-image');

        const moreButton = new Gtk.MenuButton({
            icon_name: 'open-menu-symbolic',
            tooltip_text: t('moreActions'),
            menu_model: menuModel,
        });
        header.pack_end(moreButton);

        this._copyButton = new Gtk.Button({
            icon_name: 'edit-copy-symbolic',
            tooltip_text: t('copy'),
            css_classes: ['suggested-action'],
        });
        this._copyButton.connect('clicked', () => this._copy());
        header.pack_end(this._copyButton);

        this._saveButton = this._iconButton('document-save-symbolic', t('save'), () => {
            this._save();
        });
        header.pack_end(this._saveButton);

        mainView.add_top_bar(header);

        this._toastOverlay = new Adw.ToastOverlay();
        mainView.content = this._toastOverlay;

        this._stack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.CROSSFADE,
            transition_duration: 150,
        });
        this._toastOverlay.child = this._stack;

        const openButton = new Gtk.Button({
            label: t('openImage'),
            halign: Gtk.Align.CENTER,
            css_classes: ['pill', 'suggested-action'],
        });
        openButton.connect('clicked', () => this._openImageDialog());

        const emptyPage = new Adw.StatusPage({
            icon_name: 'camera-photo-symbolic',
            title: t('emptyTitle'),
            description: t('emptyDescription'),
            child: openButton,
        });
        this._stack.add_named(emptyPage, 'empty');

        const editorBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            hexpand: true,
            vexpand: true,
        });

        this._cropRevealer = new Gtk.Revealer({
            transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN,
            reveal_child: false,
        });
        const cropBar = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            css_classes: ['crop-bar'],
        });
        this._cropLabel = new Gtk.Label({
            xalign: 0,
            hexpand: true,
            ellipsize: Pango.EllipsizeMode.END,
            css_classes: ['heading'],
        });
        cropBar.append(this._cropLabel);
        const cropCancel = new Gtk.Button({
            label: t('cancel'),
            tooltip_text: t('cancelCrop'),
        });
        cropCancel.connect('clicked', () => this._canvas.cancelPendingCrop());
        cropBar.append(cropCancel);
        const cropApply = new Gtk.Button({
            label: t('apply'),
            tooltip_text: t('applyCrop'),
            css_classes: ['suggested-action'],
        });
        cropApply.connect('clicked', () => this._canvas.applyPendingCrop());
        cropBar.append(cropApply);
        this._cropRevealer.child = cropBar;
        editorBox.append(this._cropRevealer);

        this._canvas = new ScreenshotCanvas({
            requestText: (_ix, _iy, wx, wy, callback) =>
                this._showTextPopover(wx, wy, callback),
        });
        this._canvas.connect('changed', () => this._syncActions());
        this._canvas.connect('history-changed', () => this._syncActions());
        this._canvas.connect('pending-crop-changed', () => {
            this._syncCropActions();
            this._syncActions();
        });
        this._canvas.connect('zoom-changed', () => this._syncZoomLabel());
        this._canvas.connect('file-changed', () => {
            this._syncActions();
            this._syncHistoryHighlight();
        });

        this._canvasScroll = new Gtk.ScrolledWindow({
            hexpand: true,
            vexpand: true,
            child: this._canvas,
            css_classes: ['canvas-scroll'],
        });
        this._setupMiddleButtonPan();
        editorBox.append(this._canvasScroll);
        this._stack.add_named(editorBox, 'editor');

        this._bottomBar = this._buildBottomBar();
        mainView.add_bottom_bar(this._bottomBar);

        return mainView;
    }

    _setupMiddleButtonPan() {
        // Attach pan gesture to the stationary ScrolledWindow so drag offsets stay stable.
        const pan = Gtk.GestureDrag.new();
        pan.set_button(Gdk.BUTTON_MIDDLE);
        let origin = null;
        pan.connect('drag-begin', () => {
            origin = {
                h: this._canvasScroll.hadjustment.value,
                v: this._canvasScroll.vadjustment.value,
            };
            this._canvas.setPanning(true);
        });
        pan.connect('drag-update', (_gesture, offsetX, offsetY) => {
            if (!origin)
                return;
            this._canvasScroll.hadjustment.value = origin.h - offsetX;
            this._canvasScroll.vadjustment.value = origin.v - offsetY;
        });
        const finishPan = () => {
            origin = null;
            this._canvas.setPanning(false);
        };
        pan.connect('drag-end', finishPan);
        pan.connect('cancel', finishPan);
        this._canvasScroll.add_controller(pan);
    }

    _buildBottomBar() {
        const container = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            css_classes: ['editor-bottom-bar'],
        });

        const toolbarScroll = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            vscrollbar_policy: Gtk.PolicyType.NEVER,
            propagate_natural_height: true,
        });

        const controls = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            halign: Gtk.Align.CENTER,
            css_classes: ['editor-toolbar'],
        });
        toolbarScroll.child = controls;
        container.append(toolbarScroll);

        // Tool selector
        const toolGroup = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 2,
            css_classes: ['tool-group'],
        });
        let firstTool = null;
        this._toolButtons = new Map();
        for (const [tool, icon] of TOOLS) {
            const button = new Gtk.ToggleButton({
                icon_name: icon,
                tooltip_text: t(tool),
                css_classes: ['flat', 'tool-button'],
            });
            if (firstTool)
                button.set_group(firstTool);
            else
                firstTool = button;
            button.connect('toggled', () => {
                if (button.active) {
                    this._currentTool = tool;
                    this._canvas.setTool(tool);
                    this._syncSizeTooltips();
                }
            });
            toolGroup.append(button);
            this._toolButtons.set(tool, button);
        }
        firstTool.active = true;
        controls.append(toolGroup);

        controls.append(new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL}));

        // Quick color swatches (ungrouped so selecting a custom color unchecks all swatches)
        const swatchBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
            css_classes: ['swatch-box'],
        });
        this._swatchButtons = new Map();
        for (const [hex, cssClass, labelKey] of SWATCHES) {
            const swatch = new Gtk.ToggleButton({
                tooltip_text: t(labelKey),
                valign: Gtk.Align.CENTER,
                css_classes: ['color-swatch', cssClass],
            });
            swatch.connect('toggled', () => {
                if (this._syncingColor)
                    return;
                if (swatch.active) {
                    this._setColor(hex);
                } else if (this._currentColor.toLowerCase() === hex) {
                    this._syncingColor = true;
                    swatch.active = true;
                    this._syncingColor = false;
                }
            });
            swatchBox.append(swatch);
            this._swatchButtons.set(hex, swatch);
        }
        controls.append(swatchBox);

        const customContent = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            valign: Gtk.Align.CENTER,
        });
        this._customColorDot = new Gtk.DrawingArea({
            content_width: 12,
            content_height: 12,
            valign: Gtk.Align.CENTER,
            visible: false,
        });
        this._customColorDot.set_draw_func((_area, ctx, w, h) => {
            const [r, g, b] = hexToRgb(this._currentColor);
            const radius = Math.min(w, h) / 2 - 0.75;
            ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
            ctx.setSourceRGB(r, g, b);
            ctx.fillPreserve();
            ctx.setSourceRGBA(0.5, 0.5, 0.5, 0.65);
            ctx.setLineWidth(1);
            ctx.stroke();
        });
        customContent.append(this._customColorDot);
        customContent.append(new Gtk.Image({icon_name: 'color-select-symbolic'}));

        this._customColorButton = new Gtk.Button({
            child: customContent,
            tooltip_text: t('color'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'custom-color-button'],
        });
        this._customColorButton.update_property(
            [Gtk.AccessibleProperty.LABEL], [t('color')]);
        this._customColorButton.connect('clicked', () => this._chooseCustomColor());
        controls.append(this._customColorButton);
        this._setColor('#ff3b30');

        controls.append(new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL}));

        // Segmented stroke / mosaic size buttons
        const sizeGroup = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 2,
            css_classes: ['tool-group'],
        });
        this._sizeButtons = [];
        let firstSize = null;
        for (const [widthPx, blockPx, labelKey] of SIZES) {
            const button = new Gtk.ToggleButton({
                label: t(labelKey),
                css_classes: ['flat', 'size-button'],
            });
            if (firstSize)
                button.set_group(firstSize);
            else
                firstSize = button;
            button.connect('toggled', () => {
                if (button.active)
                    this._canvas.setStrokeWidth(widthPx);
            });
            if (widthPx === 4)
                button.active = true;
            sizeGroup.append(button);
            this._sizeButtons.push({button, widthPx, blockPx});
        }
        this._syncSizeTooltips();
        controls.append(sizeGroup);

        // Status strip: file path & state pills on left, zoom controls on right
        const statusRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            css_classes: ['editor-status-bar'],
        });
        this._statusLeft = new Gtk.Label({
            label: t('untitled'),
            xalign: 0,
            hexpand: true,
            ellipsize: Pango.EllipsizeMode.MIDDLE,
            css_classes: ['meta-label'],
        });
        statusRow.append(this._statusLeft);

        this._temporaryPill = new Gtk.Label({
            label: t('temporaryBadge'),
            visible: false,
            css_classes: ['status-pill'],
        });
        statusRow.append(this._temporaryPill);

        this._modifiedPill = new Gtk.Label({
            label: t('modifiedBadge'),
            visible: false,
            css_classes: ['status-pill'],
        });
        statusRow.append(this._modifiedPill);

        const zoomGroup = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 2,
            valign: Gtk.Align.CENTER,
            css_classes: ['zoom-group'],
        });
        const zoomOut = this._iconButton('zoom-out-symbolic', t('zoomOut'), () =>
            this._canvas.zoomBy(1 / 1.22));
        zoomOut.add_css_class('zoom-icon-button');
        zoomGroup.append(zoomOut);

        this._zoomButton = new Gtk.Button({
            label: t('fitLabel'),
            tooltip_text: `${t('fit')} / ${t('actualSize')}`,
            css_classes: ['flat', 'zoom-label'],
        });
        this._zoomButton.connect('clicked', () => {
            if (this._canvas.zoomMode === 'fit')
                this._canvas.setZoom(1.0);
            else
                this._canvas.fitToWindow();
        });
        zoomGroup.append(this._zoomButton);

        const zoomIn = this._iconButton('zoom-in-symbolic', t('zoomIn'), () =>
            this._canvas.zoomBy(1.22));
        zoomIn.add_css_class('zoom-icon-button');
        zoomGroup.append(zoomIn);
        statusRow.append(zoomGroup);

        container.append(statusRow);
        return container;
    }

    _chooseCustomColor() {
        const dialog = new Gtk.ColorDialog({
            title: t('color'),
            with_alpha: false,
        });
        const initial = new Gdk.RGBA();
        initial.parse(this._currentColor);
        dialog.choose_rgba(this, initial, null, (_dialog, result) => {
            try {
                const chosen = dialog.choose_rgba_finish(result);
                if (chosen)
                    this._setColor(colorToHex(chosen));
            } catch (error) {
                if (!isDismissedError(error))
                    console.error(error.message);
            }
        });
    }

    _syncSizeTooltips() {
        if (!this._sizeButtons)
            return;
        const isMosaic = this._currentTool === 'mosaic';
        for (const {button, widthPx, blockPx} of this._sizeButtons) {
            button.tooltip_text = isMosaic
                ? `${t('mosaicBlockSize')}: ${blockPx} px`
                : `${t('strokeWidth')}: ${widthPx} px`;
        }
    }

    _setColor(hex) {
        const normalized = hex.toLowerCase();
        this._currentColor = normalized;
        this._syncingColor = true;
        try {
            this._canvas.setColor(normalized);
            let matchedSwatch = false;
            for (const [swatchHex, button] of this._swatchButtons) {
                const isMatch = swatchHex === normalized;
                button.active = isMatch;
                if (isMatch)
                    matchedSwatch = true;
            }
            if (this._customColorButton) {
                if (matchedSwatch) {
                    this._customColorButton.remove_css_class('active-custom');
                    this._customColorButton.tooltip_text = t('color');
                    if (this._customColorDot)
                        this._customColorDot.visible = false;
                } else {
                    this._customColorButton.add_css_class('active-custom');
                    this._customColorButton.tooltip_text = `${t('color')} (${normalized.toUpperCase()})`;
                    if (this._customColorDot) {
                        this._customColorDot.visible = true;
                        this._customColorDot.queue_draw();
                    }
                }
            }
        } finally {
            this._syncingColor = false;
        }
    }

    _setupKeyboardShortcuts() {
        const keys = Gtk.EventControllerKey.new();
        keys.connect('key-pressed', (_controller, rawKeyval, _keycode, state) => {
            if (this._textPopover?.visible)
                return Gdk.EVENT_PROPAGATE;

            const focus = this.get_focus();
            if (focus instanceof Gtk.TextView || focus instanceof Gtk.Editable)
                return Gdk.EVENT_PROPAGATE;

            const keyval = Gdk.keyval_to_lower(rawKeyval);
            const control = Boolean(state & Gdk.ModifierType.CONTROL_MASK);
            const shift = Boolean(state & Gdk.ModifierType.SHIFT_MASK);
            const alt = Boolean(state & Gdk.ModifierType.ALT_MASK);

            if (control && !alt) {
                if (keyval === Gdk.KEY_z && shift) {
                    this._canvas.redo();
                    return Gdk.EVENT_STOP;
                }
                if (keyval === Gdk.KEY_z) {
                    this._canvas.undo();
                    return Gdk.EVENT_STOP;
                }
                if (keyval === Gdk.KEY_y) {
                    this._canvas.redo();
                    return Gdk.EVENT_STOP;
                }
                if (keyval === Gdk.KEY_s && shift) {
                    this._saveAs();
                    return Gdk.EVENT_STOP;
                }
                if (keyval === Gdk.KEY_s) {
                    this._save();
                    return Gdk.EVENT_STOP;
                }
                if (keyval === Gdk.KEY_c) {
                    this._copy();
                    return Gdk.EVENT_STOP;
                }
                if (keyval === Gdk.KEY_o) {
                    this._openImageDialog();
                    return Gdk.EVENT_STOP;
                }
                if (rawKeyval === Gdk.KEY_plus || rawKeyval === Gdk.KEY_equal ||
                    rawKeyval === Gdk.KEY_KP_Add) {
                    this._canvas.zoomBy(1.22);
                    return Gdk.EVENT_STOP;
                }
                if (rawKeyval === Gdk.KEY_minus || rawKeyval === Gdk.KEY_KP_Subtract) {
                    this._canvas.zoomBy(1 / 1.22);
                    return Gdk.EVENT_STOP;
                }
                if (rawKeyval === Gdk.KEY_0 || rawKeyval === Gdk.KEY_KP_0) {
                    this._canvas.fitToWindow();
                    return Gdk.EVENT_STOP;
                }
                if (rawKeyval === Gdk.KEY_1 || rawKeyval === Gdk.KEY_KP_1) {
                    this._canvas.setZoom(1.0);
                    return Gdk.EVENT_STOP;
                }
            }

            if (!control && !alt && !shift && this._canvas.hasImage) {
                const digitIndex = rawKeyval - Gdk.KEY_1;
                if (digitIndex >= 0 && digitIndex < TOOLS.length) {
                    const [tool] = TOOLS[digitIndex];
                    const button = this._toolButtons.get(tool);
                    if (button)
                        button.active = true;
                    return Gdk.EVENT_STOP;
                }
            }

            if (rawKeyval === Gdk.KEY_Escape && this._canvas.pendingCrop) {
                this._canvas.cancelPendingCrop();
                return Gdk.EVENT_STOP;
            }
            if ((rawKeyval === Gdk.KEY_Return || rawKeyval === Gdk.KEY_KP_Enter) &&
                this._canvas.pendingCrop) {
                this._canvas.applyPendingCrop();
                return Gdk.EVENT_STOP;
            }
            return Gdk.EVENT_PROPAGATE;
        });
        this.add_controller(keys);
    }

    _setupDropTarget() {
        const dropTarget = Gtk.DropTarget.new(Gio.File.$gtype, Gdk.DragAction.COPY);
        dropTarget.connect('drop', (_target, value) => {
            const path = value?.get_path?.();
            if (!path) {
                this._showError(t('openFailed'), t('localFilesOnly'));
                return false;
            }
            this._requestOpenFile(path);
            return true;
        });
        this.add_controller(dropTarget);
    }

    _iconButton(iconName, tooltip, callback) {
        const button = new Gtk.Button({
            icon_name: iconName,
            tooltip_text: tooltip,
            css_classes: ['flat'],
        });
        button.connect('clicked', callback);
        return button;
    }

    _toast(title) {
        this._toastOverlay?.add_toast(new Adw.Toast({title, timeout: 2}));
    }

    _loadHistory() {
        const token = ++this._historyLoadToken;
        let child = this._historyList.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._historyList.remove(child);
            child = next;
        }
        this._historyRows = [];

        const entries = this._historyStore.entries();
        this._historyEntries = entries;
        if (entries.length === 0) {
            this._historyList.append(new Gtk.Label({
                label: t('emptyHistory'),
                wrap: true,
                justify: Gtk.Justification.CENTER,
                margin_top: 28,
                margin_bottom: 28,
                margin_start: 16,
                margin_end: 16,
                css_classes: ['meta-label'],
            }));
            return entries;
        }

        for (const entry of entries) {
            const row = new Gtk.ListBoxRow({
                activatable: true,
                css_classes: ['history-row'],
            });
            row.capturePath = entry.path;

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 5,
            });

            const thumbBox = new Gtk.Box({
                css_classes: ['history-thumb-frame'],
                overflow: Gtk.Overflow.HIDDEN,
                halign: Gtk.Align.FILL,
            });
            const picture = new Gtk.Picture({
                content_fit: Gtk.ContentFit.CONTAIN,
                can_shrink: true,
                hexpand: true,
                halign: Gtk.Align.CENTER,
                valign: Gtk.Align.CENTER,
                css_classes: ['history-thumb'],
            });
            picture.set_size_request(200, 108);
            thumbBox.append(picture);
            box.append(thumbBox);

            this._loadThumbnailAsync(entry.path, picture, row, token);

            box.append(new Gtk.Label({
                label: GLib.path_get_basename(entry.path),
                ellipsize: Pango.EllipsizeMode.END,
                xalign: 0,
                css_classes: ['caption-heading'],
            }));

            const dims = this._knownDimensions.get(entry.path) ??
                (entry.width && entry.height ? {width: entry.width, height: entry.height} : null);
            const metaParts = [];
            if (dims)
                metaParts.push(`${Math.round(dims.width)} × ${Math.round(dims.height)}`);
            const relative = formatRelativeTime(entry.createdAt);
            if (relative)
                metaParts.push(relative);
            if (metaParts.length > 0) {
                box.append(new Gtk.Label({
                    label: metaParts.join(' • '),
                    ellipsize: Pango.EllipsizeMode.END,
                    xalign: 0,
                    css_classes: ['caption', 'meta-label'],
                }));
            }

            row.child = box;
            this._historyList.append(row);
            this._historyRows.push(row);
        }

        this._syncHistoryHighlight();
        return entries;
    }

    _loadThumbnailAsync(path, picture, row, token) {
        const file = Gio.File.new_for_path(path);
        file.read_async(GLib.PRIORITY_LOW, null, (_file, readResult) => {
            if (token !== this._historyLoadToken)
                return;
            let stream;
            try {
                stream = file.read_finish(readResult);
            } catch (error) {
                if (isNotFoundError(error) && row.get_parent() === this._historyList) {
                    this._historyList.remove(row);
                    this._historyRows = this._historyRows.filter(item => item !== row);
                }
                return;
            }
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream, 220, 124, true, null, (_src, pixResult) => {
                    try {
                        stream.close(null);
                    } catch (_closeError) {
                        // Ignore stream close errors.
                    }
                    if (token !== this._historyLoadToken)
                        return;
                    try {
                        const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(pixResult);
                        if (pixbuf)
                            picture.set_paintable(Gdk.Texture.new_for_pixbuf(pixbuf));
                    } catch (_decodeError) {
                        // Leave frame blank if thumbnail cannot be decoded.
                    }
                });
        });
    }

    _syncHistoryHighlight() {
        const current = this._canvas?.filePath ?? null;
        for (const row of this._historyRows) {
            if (current && row.capturePath === current)
                row.add_css_class('active-capture');
            else
                row.remove_css_class('active-capture');
        }
    }

    _isTemporaryPath(path) {
        if (!path)
            return false;
        if (path.startsWith(runtimeCaptureDirPrefix()))
            return true;
        const match = this._historyEntries.find(entry => entry.path === path);
        return Boolean(match?.temporary);
    }

    _canDirectOverwrite() {
        const path = this._canvas.filePath;
        return Boolean(
            path &&
            this._isPngFormat &&
            !this._isTemporary &&
            !isSaveDisabledByLockdown()
        );
    }

    _hasUnsavedWork() {
        return this._canvas.isDirty || Boolean(this._canvas.pendingCrop);
    }

    _requestOpenFile(path) {
        if (!this._hasUnsavedWork()) {
            this._loadFile(path);
            return;
        }
        this._confirmDiscard(() => this._loadFile(path));
    }

    _loadFile(path) {
        this._dismissTextPopover();
        try {
            const [format] = GdkPixbuf.Pixbuf.get_file_info(path);
            const isPng = format?.get_name() === 'png';
            const etag = queryFileEtag(path);
            const temporary = this._isTemporaryPath(path);
            this._canvas.loadFile(path);
            this._isPngFormat = isPng;
            this._fileEtag = etag;
            this._isTemporary = temporary;
            const {width, height} = this._canvas.imageSize;
            this._knownDimensions.set(path, {width, height});
            this._syncActions();
        } catch (error) {
            this._showError(t('openFailed'), error.message);
        }
    }

    _openImageDialog() {
        const dialog = new Gtk.FileDialog({title: t('openImage')});
        const filter = new Gtk.FileFilter();
        filter.name = t('imageFilterName');
        filter.add_mime_type('image/png');
        filter.add_mime_type('image/jpeg');
        filter.add_mime_type('image/webp');
        filter.add_mime_type('image/svg+xml');
        dialog.default_filter = filter;
        dialog.open(this, null, (_dialog, result) => {
            try {
                const file = dialog.open_finish(result);
                const path = file?.get_path?.();
                if (!path) {
                    this._showError(t('openFailed'), t('localFilesOnly'));
                    return;
                }
                this._requestOpenFile(path);
            } catch (error) {
                if (!isDismissedError(error))
                    this._showError(t('openFailed'), error.message);
            }
        });
    }

    _dismissTextPopover() {
        if (!this._textPopover)
            return;
        const popover = this._textPopover;
        this._textPopover = null;
        if (popover.visible)
            popover.popdown();
        if (popover.get_parent())
            popover.unparent();
    }

    _showTextPopover(widgetX, widgetY, callback) {
        this._dismissTextPopover();

        const popover = new Gtk.Popover({
            autohide: true,
            has_arrow: true,
            position: Gtk.PositionType.BOTTOM,
        });
        popover.set_parent(this._canvas);
        popover.set_pointing_to(new Gdk.Rectangle({
            x: Math.round(widgetX),
            y: Math.round(widgetY),
            width: 1,
            height: 1,
        }));

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 8,
            margin_end: 8,
            width_request: 290,
        });

        const textView = new Gtk.TextView({
            wrap_mode: Gtk.WrapMode.NONE,
            accepts_tab: false,
            height_request: 60,
            css_classes: ['text-popover-view'],
        });
        const buffer = textView.buffer;

        const hint = new Gtk.Label({
            label: t('textPlaceholder'),
            xalign: 0,
            wrap: true,
            css_classes: ['caption', 'meta-label'],
        });
        box.append(hint);
        box.append(textView);

        const actions = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            halign: Gtk.Align.END,
        });
        const cancelBtn = new Gtk.Button({label: t('cancel')});
        const applyBtn = new Gtk.Button({
            label: t('apply'),
            css_classes: ['suggested-action'],
        });
        actions.append(cancelBtn);
        actions.append(applyBtn);
        box.append(actions);

        const commit = () => {
            const [start, end] = buffer.get_bounds();
            const text = buffer.get_text(start, end, false);
            popover.popdown();
            if (text.trim())
                callback(text);
        };

        cancelBtn.connect('clicked', () => popover.popdown());
        applyBtn.connect('clicked', commit);

        // Capture ONLY Ctrl+Enter on the TextView (never used by CJK IME candidate confirmation),
        // leaving plain Return and Escape untouched for GtkTextView + IME preedit handling.
        const submitKeys = Gtk.EventControllerKey.new();
        submitKeys.propagation_phase = Gtk.PropagationPhase.CAPTURE;
        submitKeys.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            const control = Boolean(state & Gdk.ModifierType.CONTROL_MASK);
            if (control && (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter)) {
                commit();
                return Gdk.EVENT_STOP;
            }
            return Gdk.EVENT_PROPAGATE;
        });
        textView.add_controller(submitKeys);

        // Close on Escape only if GtkTextView / IME did not consume it during preedit.
        const containerKeys = Gtk.EventControllerKey.new();
        containerKeys.connect('key-pressed', (_controller, keyval) => {
            if (keyval === Gdk.KEY_Escape) {
                popover.popdown();
                return Gdk.EVENT_STOP;
            }
            return Gdk.EVENT_PROPAGATE;
        });
        box.add_controller(containerKeys);

        popover.connect('closed', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._textPopover === popover)
                    this._textPopover = null;
                if (popover.get_parent())
                    popover.unparent();
                return GLib.SOURCE_REMOVE;
            });
        });

        popover.child = box;
        this._textPopover = popover;
        popover.popup();
        textView.grab_focus();
    }

    _confirmDiscard(onProceed) {
        const hasPendingCrop = Boolean(this._canvas.pendingCrop);
        const saveDisabled = isSaveDisabledByLockdown();
        const dialog = new Adw.AlertDialog({
            heading: t('unsavedHeading'),
            body: t('unsavedBody'),
        });
        dialog.add_response('cancel', t('cancel'));
        dialog.add_response('discard', t('discard'));
        dialog.set_response_appearance('discard', Adw.ResponseAppearance.DESTRUCTIVE);
        if (!saveDisabled) {
            dialog.add_response(
                'save',
                hasPendingCrop ? t('applyCropAndSave') : t('saveChanges')
            );
            dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
            dialog.set_default_response('save');
        } else {
            dialog.set_default_response('cancel');
        }
        dialog.set_close_response('cancel');

        dialog.choose(this, null, async (_dialog, result) => {
            let response = 'cancel';
            try {
                response = dialog.choose_finish(result);
            } catch (_error) {
                return;
            }
            if (response === 'discard') {
                onProceed();
            } else if (response === 'save') {
                if (this._canvas.pendingCrop)
                    this._canvas.applyPendingCrop();
                const saved = await this._save();
                if (saved)
                    onProceed();
            }
        });
    }

    _askChoice({heading, body, responses, defaultResponse, closeResponse = 'cancel'}) {
        return new Promise(resolve => {
            const dialog = new Adw.AlertDialog({heading, body});
            for (const {id, label, appearance} of responses) {
                dialog.add_response(id, label);
                if (appearance)
                    dialog.set_response_appearance(id, appearance);
            }
            if (defaultResponse)
                dialog.set_default_response(defaultResponse);
            dialog.set_close_response(closeResponse);
            dialog.choose(this, null, (_d, result) => {
                try {
                    resolve(dialog.choose_finish(result));
                } catch (_error) {
                    resolve(closeResponse);
                }
            });
        });
    }

    _ensureExportReady() {
        if (!this._canvas.hasImage)
            return false;
        if (this._canvas.isInteracting) {
            this._toast(t('finishDrawingFirst'));
            return false;
        }
        if (this._canvas.pendingCrop) {
            this._toast(t('resolveCropFirst'));
            return false;
        }
        return true;
    }

    async _save() {
        if (!this._ensureExportReady())
            return false;
        if (isSaveDisabledByLockdown()) {
            this._toast(t('saveDisabledByPolicy'));
            return false;
        }
        if (!this._canDirectOverwrite())
            return this._saveAs();

        const path = this._canvas.filePath;
        try {
            const saved = this._canvas.exportPng(path, {expectedEtag: this._fileEtag});
            this._fileEtag = saved.etag;
            this._isTemporary = false;
            this._isPngFormat = true;
            this._knownDimensions.set(path, {width: saved.width, height: saved.height});
            this._canvas.markSaved(path);
            this._toast(t('saved'));
            this._loadHistory();
            return true;
        } catch (error) {
            if (isConflictError(error))
                return this._handleConcurrentModification(path);
            this._showError(t('saveFailed'), error.message);
            return false;
        }
    }

    async _handleConcurrentModification(path) {
        const responses = [
            {id: 'cancel', label: t('cancel')},
        ];
        if (path && path === this._canvas.filePath)
            responses.push({id: 'reload', label: t('reload')});
        responses.push(
            {id: 'overwrite', label: t('overwrite'), appearance: Adw.ResponseAppearance.DESTRUCTIVE},
            {id: 'save-as', label: t('saveAs'), appearance: Adw.ResponseAppearance.SUGGESTED}
        );

        const choice = await this._askChoice({
            heading: t('fileChangedHeading'),
            body: t('fileChangedBody'),
            responses,
            defaultResponse: 'save-as',
        });

        if (choice === 'save-as')
            return this._saveAs();
        if (choice === 'reload') {
            this._loadFile(path);
            return false;
        }
        if (choice === 'overwrite' && path) {
            try {
                const saved = this._canvas.exportPng(path, {expectedEtag: null});
                this._fileEtag = saved.etag;
                this._isTemporary = this._isTemporaryPath(path);
                this._isPngFormat = true;
                this._knownDimensions.set(path, {width: saved.width, height: saved.height});
                this._canvas.markSaved(path);
                this._toast(t('saved'));
                this._loadHistory();
                return true;
            } catch (error) {
                this._showError(t('saveFailed'), error.message);
            }
        }
        return false;
    }

    _saveAs() {
        if (!this._ensureExportReady())
            return Promise.resolve(false);
        if (isSaveDisabledByLockdown()) {
            this._toast(t('saveDisabledByPolicy'));
            return Promise.resolve(false);
        }

        const dialog = new Gtk.FileDialog({
            title: t('saveAs'),
            initial_name: suggestedPngName(
                this._canvas.filePath
                    ? GLib.path_get_basename(this._canvas.filePath)
                    : 'Screenshot.png'
            ),
        });
        if (this._isTemporary)
            dialog.initial_folder = defaultScreenshotsFolder();
        else if (this._canvas.filePath)
            dialog.initial_folder = Gio.File.new_for_path(this._canvas.filePath).get_parent();

        const filter = new Gtk.FileFilter();
        filter.name = t('pngFilterName');
        filter.add_mime_type('image/png');
        dialog.default_filter = filter;

        return new Promise(resolve => {
            dialog.save(this, null, async (_dialog, result) => {
                let targetPath = null;
                try {
                    const file = dialog.save_finish(result);
                    const chosenPath = file?.get_path?.();
                    if (!chosenPath) {
                        this._showError(t('saveFailed'), t('localFilesOnly'));
                        resolve(false);
                        return;
                    }

                    targetPath = chosenPath;
                    const appendedExtension = !/\.png$/i.test(targetPath);
                    if (appendedExtension)
                        targetPath = `${targetPath}.png`;

                    const existedBefore = Gio.File.new_for_path(targetPath).query_exists(null);
                    const expectedEtag = existedBefore ? queryFileEtag(targetPath) : null;

                    // Confirm if adding .png targets an existing file the chooser did not confirm.
                    if (appendedExtension && existedBefore) {
                        const answer = await this._askChoice({
                            heading: t('overwriteConfirmHeading'),
                            body: t('overwriteConfirmBody', {
                                name: GLib.path_get_basename(targetPath),
                            }),
                            responses: [
                                {id: 'cancel', label: t('cancel')},
                                {
                                    id: 'overwrite',
                                    label: t('overwrite'),
                                    appearance: Adw.ResponseAppearance.DESTRUCTIVE,
                                },
                            ],
                            defaultResponse: 'cancel',
                        });
                        if (answer !== 'overwrite') {
                            resolve(false);
                            return;
                        }
                    }

                    const saved = this._canvas.exportPng(
                        targetPath,
                        existedBefore ? {expectedEtag} : {exclusive: true}
                    );
                    this._fileEtag = saved.etag;
                    this._isTemporary = this._isTemporaryPath(targetPath);
                    this._isPngFormat = true;
                    this._knownDimensions.set(targetPath, {
                        width: saved.width,
                        height: saved.height,
                    });
                    this._canvas.markSaved(targetPath);
                    this._toast(t('savedAs', {name: GLib.path_get_basename(targetPath)}));
                    this._loadHistory();
                    resolve(true);
                } catch (error) {
                    if (isConflictError(error) && targetPath) {
                        resolve(await this._handleConcurrentModification(targetPath));
                        return;
                    }
                    if (!isDismissedError(error))
                        this._showError(t('saveFailed'), error.message);
                    resolve(false);
                }
            });
        });
    }

    _copy() {
        if (!this._ensureExportReady())
            return;
        try {
            const pngBytes = this._canvas.exportPngBytes();
            const provider = Gdk.ContentProvider.new_for_bytes('image/png', pngBytes);
            const clipboard = Gdk.Display.get_default()?.get_clipboard();
            if (!clipboard || !clipboard.set_content(provider))
                throw new Error(t('copyFailed'));
            this._toast(t('copied'));
        } catch (error) {
            this._showError(t('copyFailed'), error.message);
        }
    }

    _syncActions() {
        const loaded = this._canvas?.hasImage ?? false;
        const hasPendingCrop = Boolean(this._canvas?.pendingCrop);
        const canExport = loaded && !hasPendingCrop;
        const saveAllowed = !isSaveDisabledByLockdown();

        this._stack.visible_child_name = loaded ? 'editor' : 'empty';
        this._bottomBar.visible = loaded;

        this._undoButton.sensitive = loaded && this._canvas.canUndo;
        this._redoButton.sensitive = loaded && this._canvas.canRedo;
        this._clearButton.sensitive = loaded && this._canvas.hasAnnotations;
        this._saveButton.sensitive = canExport && saveAllowed &&
            (this._canvas.isDirty || !this._canDirectOverwrite());
        this._copyButton.sensitive = canExport;
        this._saveAsAction.enabled = canExport && saveAllowed;
        this._showFilesAction.enabled = loaded && Boolean(this._canvas.filePath) && !this._isTemporary;

        if (loaded) {
            const {width, height} = this._canvas.imageSize;
            const basename = this._canvas.filePath
                ? GLib.path_get_basename(this._canvas.filePath)
                : t('appName');
            const dirty = this._hasUnsavedWork();
            this.title = `${basename}${dirty ? ' •' : ''}`;
            this._windowTitle.title = basename;
            if (hasPendingCrop) {
                const pending = this._canvas.pendingCrop;
                this._windowTitle.subtitle =
                    `${Math.round(width)} × ${Math.round(height)} → ` +
                    `${Math.round(pending.width)} × ${Math.round(pending.height)} px`;
            } else {
                this._windowTitle.subtitle = `${Math.round(width)} × ${Math.round(height)} px`;
            }
            this._statusLeft.label = this._canvas.filePath ?? basename;
            this._temporaryPill.visible = this._isTemporary;
            this._modifiedPill.visible = dirty;
        } else {
            this.title = t('appName');
            this._windowTitle.title = t('appName');
            this._windowTitle.subtitle = '';
            this._statusLeft.label = t('untitled');
            this._temporaryPill.visible = false;
            this._modifiedPill.visible = false;
        }
    }

    _syncCropActions() {
        const pending = this._canvas.pendingCrop;
        const visible = Boolean(pending);
        this._cropRevealer.reveal_child = visible;
        if (pending) {
            this._cropLabel.label = t('cropBanner', {
                width: Math.round(pending.width),
                height: Math.round(pending.height),
            });
        }
    }

    _syncZoomLabel() {
        if (!this._zoomButton || !this._canvas)
            return;
        const percent = Math.round(this._canvas.zoomScale * 100);
        this._zoomButton.label = this._canvas.zoomMode === 'fit'
            ? `${t('fitLabel')} (${percent}%)`
            : `${percent}%`;
    }

    _showError(heading, detail) {
        const dialog = new Adw.AlertDialog({
            heading,
            body: detail,
        });
        dialog.add_response('close', t('cancel'));
        dialog.set_close_response('close');
        dialog.present(this);
    }
});
