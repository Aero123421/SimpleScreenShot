// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {formatFilenamePattern} from './geometry.js';
import {t} from './i18n.js';

const DEFAULT_SHORTCUT = '<Shift><Super>s';
const DEFAULT_PATTERN = 'Screenshot {timestamp}';
const SHORTCUT_KEY = 'simple-screenshot-open-overlay';
const LEGACY_SHORTCUT_KEY = 'shortcut';
const MODES = ['region', 'window', 'screen'];

const MODIFIER_KEYS = new Set([
    Gdk.KEY_Shift_L,
    Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L,
    Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L,
    Gdk.KEY_Alt_R,
    Gdk.KEY_Super_L,
    Gdk.KEY_Super_R,
    Gdk.KEY_Meta_L,
    Gdk.KEY_Meta_R,
    Gdk.KEY_Hyper_L,
    Gdk.KEY_Hyper_R,
    Gdk.KEY_ISO_Level3_Shift,
    Gdk.KEY_ISO_Level5_Shift,
    Gdk.KEY_Caps_Lock,
    Gdk.KEY_Num_Lock,
]);

function isDismissedError(error) {
    return error instanceof GLib.Error &&
        error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED);
}

function isValidGlobalShortcut(keyval, keycode, modifiers) {
    if (!Gtk.accelerator_valid(keyval, modifiers))
        return false;

    const strongModifiers = Gdk.ModifierType.CONTROL_MASK |
        Gdk.ModifierType.ALT_MASK |
        Gdk.ModifierType.SUPER_MASK |
        Gdk.ModifierType.META_MASK |
        Gdk.ModifierType.HYPER_MASK;
    const worksOnItsOwn = keyval === Gdk.KEY_Print ||
        (keyval >= Gdk.KEY_F1 && keyval <= Gdk.KEY_F35);

    // Global shortcuts without Ctrl, Alt, or Super interfere with normal use.
    return keycode === 0 || worksOnItsOwn || (modifiers & strongModifiers) !== 0;
}

function shortcutDisplayName(accelerator) {
    if (!accelerator)
        return t('prefsNotSet');

    const [success, keyval, modifiers] = Gtk.accelerator_parse(accelerator);
    return success ? Gtk.accelerator_get_label(keyval, modifiers) : t('prefsNotSet');
}

function currentDateParts() {
    const now = GLib.DateTime.new_now_local();
    return {
        year: now.format('%Y'),
        month: now.format('%m'),
        day: now.format('%d'),
        hour: now.format('%H'),
        minute: now.format('%M'),
        second: now.format('%S'),
    };
}

function showShortcutRecorder(window, settings) {
    const dialog = new Adw.Window({
        title: t('prefsShortcutDialogTitle'),
        transient_for: window,
        modal: true,
        resizable: false,
        default_width: 480,
        default_height: 360,
    });

    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(new Adw.HeaderBar());
    dialog.content = toolbarView;

    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 18,
        vexpand: true,
        valign: Gtk.Align.CENTER,
        margin_top: 20,
        margin_bottom: 24,
        margin_start: 32,
        margin_end: 32,
    });
    toolbarView.content = content;

    // Focusable capture target so Tab navigation to the action buttons below still works.
    const captureArea = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 16,
        focusable: true,
        can_focus: true,
        halign: Gtk.Align.FILL,
    });

    const icon = new Gtk.Image({
        icon_name: 'input-keyboard-symbolic',
        pixel_size: 48,
        css_classes: ['accent'],
    });
    captureArea.append(icon);

    const heading = new Gtk.Label({
        label: t('prefsShortcutHeading'),
        justify: Gtk.Justification.CENTER,
        css_classes: ['title-2'],
    });
    captureArea.append(heading);

    const preview = new Gtk.ShortcutLabel({
        accelerator: settings.get_strv(SHORTCUT_KEY)[0] ?? '',
        disabled_text: t('prefsShortcutWaiting'),
        halign: Gtk.Align.CENTER,
    });
    captureArea.append(preview);

    const hint = new Gtk.Label({
        label: t('prefsShortcutHint'),
        justify: Gtk.Justification.CENTER,
        wrap: true,
        css_classes: ['dim-label'],
    });
    captureArea.append(hint);
    content.append(captureArea);

    const saveShortcut = accelerator => {
        settings.set_strv(SHORTCUT_KEY, accelerator ? [accelerator] : []);
        const message = accelerator
            ? t('prefsShortcutToastSet', {shortcut: shortcutDisplayName(accelerator)})
            : t('prefsShortcutToastCleared');
        window.add_toast(new Adw.Toast({title: message, timeout: 3}));
    };

    const actions = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 10,
        homogeneous: true,
        margin_top: 6,
    });
    const cancel = new Gtk.Button({label: t('prefsShortcutCancel')});
    cancel.connect('clicked', () => dialog.close());
    actions.append(cancel);

    const clear = new Gtk.Button({label: t('prefsShortcutClear')});
    clear.connect('clicked', () => {
        saveShortcut('');
        dialog.close();
    });
    actions.append(clear);

    const useDefault = new Gtk.Button({
        label: t('prefsShortcutUseDefault'),
        tooltip_text: 'Shift + Super + S',
        css_classes: ['suggested-action'],
    });
    useDefault.connect('clicked', () => {
        saveShortcut(DEFAULT_SHORTCUT);
        dialog.close();
    });
    actions.append(useDefault);
    content.append(actions);

    let shortcutsInhibited = false;
    const inhibitShortcuts = () => {
        if (shortcutsInhibited)
            return;
        const surface = dialog.get_surface();
        if (surface?.inhibit_system_shortcuts) {
            surface.inhibit_system_shortcuts(null);
            shortcutsInhibited = true;
        }
    };
    const restoreShortcuts = () => {
        if (!shortcutsInhibited)
            return;
        dialog.get_surface()?.restore_system_shortcuts?.();
        shortcutsInhibited = false;
    };

    const focusController = new Gtk.EventControllerFocus();
    focusController.connect('enter', inhibitShortcuts);
    focusController.connect('leave', restoreShortcuts);
    captureArea.add_controller(focusController);

    dialog.connect('close-request', () => {
        restoreShortcuts();
        return false;
    });
    dialog.connect('destroy', restoreShortcuts);

    const keys = Gtk.EventControllerKey.new();
    keys.connect('key-pressed', (_controller, pressedKeyval, keycode, state) => {
        const cleanModifiers = (state & Gtk.accelerator_get_default_mod_mask()) &
            ~Gdk.ModifierType.LOCK_MASK;

        if (pressedKeyval === Gdk.KEY_Escape && cleanModifiers === 0) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }

        // Preserve keyboard focus traversal (Tab / Shift+Tab) to the action buttons below.
        if ((pressedKeyval === Gdk.KEY_Tab || pressedKeyval === Gdk.KEY_ISO_Left_Tab) &&
            (cleanModifiers & ~Gdk.ModifierType.SHIFT_MASK) === 0) {
            return Gdk.EVENT_PROPAGATE;
        }

        if (MODIFIER_KEYS.has(pressedKeyval)) {
            preview.accelerator = '';
            preview.disabled_text = t('prefsShortcutKeepHolding');
            return Gdk.EVENT_STOP;
        }

        let keyval = pressedKeyval;
        if (keyval === Gdk.KEY_ISO_Left_Tab)
            keyval = Gdk.KEY_Tab;
        keyval = Gdk.keyval_to_lower(keyval);

        if (!isValidGlobalShortcut(keyval, keycode, cleanModifiers)) {
            preview.accelerator = '';
            preview.disabled_text = t('prefsShortcutNeedModifier');
            hint.label = t('prefsShortcutInterfere');
            return Gdk.EVENT_STOP;
        }

        const accelerator = Gtk.accelerator_name(keyval, cleanModifiers);
        preview.accelerator = accelerator;
        restoreShortcuts();
        saveShortcut(accelerator);
        dialog.destroy();
        return Gdk.EVENT_STOP;
    });
    captureArea.add_controller(keys);

    // Allow Escape to close the dialog even when focus is on one of the buttons.
    const dialogKeys = Gtk.EventControllerKey.new();
    dialogKeys.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        const mods = (state & Gtk.accelerator_get_default_mod_mask()) &
            ~Gdk.ModifierType.LOCK_MASK;
        if (keyval === Gdk.KEY_Escape && mods === 0) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        return Gdk.EVENT_PROPAGATE;
    });
    dialog.add_controller(dialogKeys);

    dialog.present();
    captureArea.grab_focus();
    inhibitShortcuts();
}

function addSwitch(group, settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
    return row;
}

export default class SimpleScreenshotPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const signalIds = [];

        if (settings.get_user_value(SHORTCUT_KEY) === null &&
            settings.get_user_value(LEGACY_SHORTCUT_KEY) !== null) {
            settings.set_strv(SHORTCUT_KEY, settings.get_strv(LEGACY_SHORTCUT_KEY));
        }

        window.set_default_size(680, 740);
        window.search_enabled = true;

        const general = new Adw.PreferencesPage({
            title: t('prefsGeneral'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(general);

        const behavior = new Adw.PreferencesGroup({title: t('prefsCaptureBehavior')});
        general.add(behavior);
        addSwitch(behavior, settings, 'copy-to-clipboard',
            t('prefsCopyTitle'), t('prefsCopySubtitle'));
        addSwitch(behavior, settings, 'save-copies',
            t('prefsSaveCopiesTitle'), t('prefsSaveCopiesSubtitle'));
        addSwitch(behavior, settings, 'show-notification',
            t('prefsNotificationTitle'), t('prefsNotificationSubtitle'));
        addSwitch(behavior, settings, 'auto-open-editor',
            t('prefsAutoEditorTitle'), t('prefsAutoEditorSubtitle'));
        addSwitch(behavior, settings, 'include-pointer',
            t('prefsPointerTitle'), t('prefsPointerSubtitle'));
        addSwitch(behavior, settings, 'show-indicator',
            t('prefsIndicatorTitle'), t('prefsIndicatorSubtitle'));

        const capture = new Adw.PreferencesGroup({title: t('prefsCaptureControls')});
        general.add(capture);

        const shortcut = new Adw.ActionRow({
            title: t('prefsShortcutTitle'),
            subtitle: t('prefsShortcutSubtitle'),
        });
        const shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: settings.get_strv(SHORTCUT_KEY)[0] ?? '',
            disabled_text: t('prefsNotSet'),
            valign: Gtk.Align.CENTER,
        });
        const changeShortcut = new Gtk.Button({
            label: t('prefsChange'),
            valign: Gtk.Align.CENTER,
        });
        changeShortcut.connect('clicked', () =>
            showShortcutRecorder(window, settings));
        shortcut.add_suffix(shortcutLabel);
        shortcut.add_suffix(changeShortcut);
        shortcut.activatable_widget = changeShortcut;
        capture.add(shortcut);

        signalIds.push(settings.connect(`changed::${SHORTCUT_KEY}`, () => {
            shortcutLabel.accelerator = settings.get_strv(SHORTCUT_KEY)[0] ?? '';
        }));

        const modeModel = Gtk.StringList.new([
            t('prefsModeRegion'),
            t('prefsModeWindow'),
            t('prefsModeScreen'),
        ]);
        const modeRow = new Adw.ComboRow({
            title: t('prefsDefaultMode'),
            model: modeModel,
            selected: Math.max(0, MODES.indexOf(settings.get_string('default-mode'))),
        });
        modeRow.connect('notify::selected', () => {
            const selectedMode = MODES[modeRow.selected];
            if (selectedMode && settings.get_string('default-mode') !== selectedMode)
                settings.set_string('default-mode', selectedMode);
        });
        signalIds.push(settings.connect('changed::default-mode', () => {
            const index = Math.max(0, MODES.indexOf(settings.get_string('default-mode')));
            if (modeRow.selected !== index)
                modeRow.selected = index;
        }));
        capture.add(modeRow);

        const storage = new Adw.PreferencesPage({
            title: t('prefsStorage'),
            icon_name: 'folder-pictures-symbolic',
        });
        window.add(storage);

        const files = new Adw.PreferencesGroup({title: t('prefsFilesHistory')});
        storage.add(files);

        const directoryRow = new Adw.ActionRow({
            title: t('prefsSaveDirectory'),
        });
        const resetDirectory = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: t('prefsReset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        const syncDirectoryRow = () => {
            const configured = settings.get_string('save-directory').trim();
            directoryRow.subtitle = configured || t('prefsDefaultDirectory');
            resetDirectory.visible = configured.length > 0;
        };
        resetDirectory.connect('clicked', () => {
            settings.set_string('save-directory', '');
            syncDirectoryRow();
        });
        const chooseDirectory = new Gtk.Button({
            label: t('prefsChoose'),
            valign: Gtk.Align.CENTER,
        });
        chooseDirectory.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: t('prefsChooseDirectoryTitle')});
            dialog.select_folder(window, null, (_dialog, result) => {
                try {
                    const folder = dialog.select_folder_finish(result);
                    const folderPath = folder?.get_path?.();
                    if (!folderPath) {
                        window.add_toast(new Adw.Toast({
                            title: t('prefsLocalFolderOnly'),
                            timeout: 3,
                        }));
                        return;
                    }
                    settings.set_string('save-directory', folderPath);
                    syncDirectoryRow();
                } catch (error) {
                    if (!isDismissedError(error))
                        console.error(error.message);
                }
            });
        });
        directoryRow.add_suffix(resetDirectory);
        directoryRow.add_suffix(chooseDirectory);
        directoryRow.activatable_widget = chooseDirectory;
        syncDirectoryRow();
        signalIds.push(settings.connect('changed::save-directory', syncDirectoryRow));
        files.add(directoryRow);

        const filename = new Adw.EntryRow({
            title: t('prefsFilenamePattern'),
            text: settings.get_string('filename-pattern'),
        });
        const resetFilename = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: t('prefsReset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        const updateFilenamePreview = () => {
            const pattern = filename.text;
            const example = formatFilenamePattern(pattern, currentDateParts());
            files.description = t('prefsFilenamePreview', {example});
            resetFilename.visible = pattern !== DEFAULT_PATTERN;
        };
        resetFilename.connect('clicked', () => {
            filename.text = DEFAULT_PATTERN;
        });
        filename.add_suffix(resetFilename);
        filename.connect('notify::text', () => {
            if (settings.get_string('filename-pattern') !== filename.text)
                settings.set_string('filename-pattern', filename.text);
            updateFilenamePreview();
        });
        signalIds.push(settings.connect('changed::filename-pattern', () => {
            const value = settings.get_string('filename-pattern');
            if (filename.text !== value)
                filename.text = value;
            updateFilenamePreview();
        }));
        updateFilenamePreview();
        files.add(filename);

        const history = Adw.SpinRow.new_with_range(1, 200, 1);
        history.title = t('prefsHistoryLimit');
        history.subtitle = t('prefsHistoryLimitSubtitle');
        settings.bind('history-limit', history, 'value', Gio.SettingsBindFlags.DEFAULT);
        files.add(history);

        window.connect('close-request', () => {
            for (const id of signalIds)
                settings.disconnect(id);
            signalIds.length = 0;
            return false;
        });
    }
}
