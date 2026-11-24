// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import GLib from 'gi://GLib';

import {selectLanguage} from './geometry.js';

const japanese = selectLanguage(GLib.get_language_names()) === 'ja';

export const strings = {
    // Overlay modes & hints
    region: ['Rectangular', '四角形'],
    window: ['Window', 'ウィンドウ'],
    screen: ['Full screen', '全画面'],
    regionHint: ['Drag to select an area • Right-click or Esc to cancel', 'ドラッグして領域を選択 • 右クリックまたは Esc でキャンセル'],
    windowHint: ['Click a window to capture • Enter to confirm • Esc to cancel', '撮影するウィンドウをクリック • Enter で確定 • Esc でキャンセル'],
    screenHint: ['Click a display to capture • Enter to confirm • Esc to cancel', '撮影する画面をクリック • Enter で確定 • Esc でキャンセル'],
    cancel: ['Close', '閉じる'],
    settings: ['Settings', '設定'],

    // Notifications & top-panel menu
    copied: ['Copied to clipboard', 'クリップボードにコピーしました'],
    captured: ['Screenshot captured', 'スクリーンショットを撮影しました'],
    notificationCopiedBody: ['Copied to clipboard. Click to annotate.', 'クリップボードにコピーしました。クリックして編集できます。'],
    notificationCopiedOnlyBody: ['Copied to clipboard. Saving to disk is disabled by system policy.', 'クリップボードにコピーしました（システム設定によりファイル保存は無効です）。'],
    notificationSaveDisabledBody: ['Saving to disk is disabled by system policy and clipboard copy is turned off.', 'システム設定によりファイル保存が無効で、クリップボードへのコピーもオフになっています。'],
    notificationBody: ['Click the preview to mark it up.', 'プレビューをクリックすると編集できます。'],
    edit: ['Edit', '編集'],
    showFiles: ['Show in Files', 'ファイルで表示'],
    area: ['Capture area', '領域を撮影'],
    captureWindow: ['Capture window', 'ウィンドウを撮影'],
    captureScreen: ['Capture screen', '画面を撮影'],
    openEditor: ['Open editor', 'エディタを開く'],
    history: ['Recent captures', '最近の撮影'],
    openFailed: ['Could not open the screenshot editor', 'スクリーンショットエディタを開けませんでした'],

    // Preferences — Pages & Groups
    prefsGeneral: ['General', '一般'],
    prefsStorage: ['Storage', '保存設定'],
    prefsCaptureBehavior: ['Capture behavior', '撮影の動作'],
    prefsCaptureControls: ['Capture controls', '撮影コントロール'],
    prefsFilesHistory: ['Files and history', 'ファイルと履歴'],

    // Preferences — Switches
    prefsCopyTitle: ['Copy to clipboard', 'クリップボードへコピー'],
    prefsCopySubtitle: ['Make every new capture immediately pasteable', '撮影した画像をすぐに貼り付けられるようにします'],
    prefsSaveCopiesTitle: ['Save a copy', 'ファイルとして保存'],
    prefsSaveCopiesSubtitle: ['Keep the original PNG on disk before editing', '編集前の元画像をPNGファイルとして保存します'],
    prefsNotificationTitle: ['Show preview notification', 'プレビュー通知を表示'],
    prefsNotificationSubtitle: ['Click the notification to open the editor', '通知をクリックして注釈エディタを開けます'],
    prefsAutoEditorTitle: ['Open editor after capture', '撮影後すぐにエディタを開く'],
    prefsAutoEditorSubtitle: ['Open the annotation editor automatically after capturing', '通知を待たずに撮影直後から編集を始めます'],
    prefsPointerTitle: ['Include mouse pointer', 'マウスポインターを含める'],
    prefsPointerSubtitle: ['Draw the pointer into the captured screenshot', '撮影時のカーソルを画像に含めます'],
    prefsIndicatorTitle: ['Show top-panel button', 'トップパネルにアイコンを表示'],
    prefsIndicatorSubtitle: ['Keep capture actions accessible in the system panel', '上部のシステムパネルから撮影や履歴へすぐアクセスできます'],

    // Preferences — Shortcut recorder
    prefsShortcutTitle: ['Keyboard shortcut', 'ショートカットキー'],
    prefsShortcutSubtitle: ['Opens the snipping overlay from anywhere', 'どの画面からでも切り取りオーバーレイを開きます'],
    prefsChange: ['Change…', '変更…'],
    prefsNotSet: ['Not set', '未設定'],
    prefsShortcutDialogTitle: ['Set keyboard shortcut', 'ショートカットキーの設定'],
    prefsShortcutHeading: ['Press the new shortcut now', '新しいショートカットを押してください'],
    prefsShortcutWaiting: ['Waiting for keys…', 'キー入力を待機中…'],
    prefsShortcutKeepHolding: ['Keep holding, then press another key…', '修飾キーを押したまま別のキーを押してください…'],
    prefsShortcutHint: ['Hold Ctrl, Alt, or Super with another key (e.g. Shift + Super + S).\nPress Tab to move to the buttons below.', 'Ctrl / Alt / Super と別のキーを組み合わせて押してください（例: Shift + Super + S）。\nTab キーで下のボタンへ移動できます。'],
    prefsShortcutNeedModifier: ['Add Ctrl, Alt, or Super', 'Ctrl / Alt / Super を組み合わせてください'],
    prefsShortcutInterfere: ['That key would interfere with normal typing.\nTry a combination such as Shift + Super + S.', '通常の文字入力と干渉するキーです。\nShift + Super + S のような組み合わせを使用してください。'],
    prefsShortcutCancel: ['Cancel', 'キャンセル'],
    prefsShortcutClear: ['Clear', '解除'],
    prefsShortcutUseDefault: ['Use default', '既定に戻す'],
    prefsShortcutToastSet: ['Shortcut set to {shortcut}', 'ショートカットを {shortcut} に設定しました'],
    prefsShortcutToastCleared: ['Keyboard shortcut cleared', 'ショートカットキーを解除しました'],

    // Preferences — Default mode & Storage
    prefsDefaultMode: ['Default mode', '既定の撮影モード'],
    prefsModeRegion: ['Rectangular snip', '四角形の領域切り取り'],
    prefsModeWindow: ['Window snip', 'ウィンドウの切り取り'],
    prefsModeScreen: ['Full-screen snip', '全画面の切り取り'],
    prefsSaveDirectory: ['Save directory', '保存先フォルダー'],
    prefsDefaultDirectory: ['Pictures/Screenshots (default)', 'ピクチャ/Screenshots（既定）'],
    prefsChoose: ['Choose…', '選択…'],
    prefsReset: ['Reset to default', '既定に戻す'],
    prefsChooseDirectoryTitle: ['Choose screenshot directory', '保存先フォルダーを選択'],
    prefsLocalFolderOnly: ['Please choose a local folder on this computer', 'このコンピューター上のローカルフォルダーを選択してください'],
    prefsFilenamePattern: ['Filename pattern', 'ファイル名のパターン'],
    prefsFilenamePreview: ['Preview: {example}.png  •  Placeholders: {date}, {time}, {timestamp}', '例: {example}.png  •  利用可能: {date}, {time}, {timestamp}'],
    prefsHistoryLimit: ['History limit', '履歴の保存件数'],
    prefsHistoryLimitSubtitle: ['Maximum captures listed in the editor sidebar', 'エディタの履歴サイドバーに表示する最大件数'],
};

export function t(key, vars = null) {
    const value = strings[key] ?? [key, key];
    let text = value[japanese ? 1 : 0];
    if (vars) {
        for (const [name, replacement] of Object.entries(vars))
            text = text.replaceAll(`{${name}}`, String(replacement));
    }
    return text;
}
