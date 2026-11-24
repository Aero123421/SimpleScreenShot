// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import GLib from 'gi://GLib';

import {selectLanguage} from '../geometry.js';

const japanese = selectLanguage(GLib.get_language_names()) === 'ja';

export const strings = {
    appName: ['Simple ScreenShot', 'Simple ScreenShot'],
    untitled: ['No screenshot selected', 'スクリーンショットが選択されていません'],
    emptyTitle: ['No Screenshot Loaded', 'スクリーンショットがありません'],
    emptyDescription: ['Capture with Shift + Super + S, pick from recent history, or open an image file to annotate.', 'Shift + Super + S で撮影するか、最近の履歴や画像ファイルを開いて編集できます。'],
    openImage: ['Open image…', '画像を開く…'],
    history: ['History', '履歴'],
    refreshHistory: ['Refresh history', '履歴を更新'],
    showInFiles: ['Show in Files', 'ファイルで表示'],
    moreActions: ['More actions', 'その他の操作'],
    undo: ['Undo (Ctrl+Z)', '元に戻す (Ctrl+Z)'],
    redo: ['Redo (Ctrl+Y)', 'やり直す (Ctrl+Y)'],
    clearAnnotations: ['Clear all annotations', '注釈をすべて消去'],
    copy: ['Copy (Ctrl+C)', 'コピー (Ctrl+C)'],
    save: ['Save (Ctrl+S)', '保存 (Ctrl+S)'],
    saveAs: ['Save as…', '名前を付けて保存…'],
    pen: ['Pen (1)', 'ペン (1)'],
    highlighter: ['Highlighter (2)', '蛍光ペン (2)'],
    arrow: ['Arrow (3) • Hold Shift for 45°', '矢印 (3) • Shiftで45°固定'],
    rectangle: ['Rectangle (4) • Hold Shift for square', '四角形 (4) • Shiftで正方形'],
    ellipse: ['Ellipse (5) • Hold Shift for circle', '楕円 (5) • Shiftで正円'],
    text: ['Text (6)', '文字 (6)'],
    mosaic: ['Mosaic (7)', 'モザイク (7)'],
    crop: ['Crop (8)', '切り抜き (8)'],
    apply: ['Apply', '適用'],
    cancel: ['Cancel', 'キャンセル'],
    applyCrop: ['Apply crop (Enter)', '切り抜きを適用 (Enter)'],
    cancelCrop: ['Cancel crop (Esc)', 'キャンセル (Esc)'],
    cropBanner: ['Crop selection: {width} × {height} px — drag handles to adjust', '切り抜き範囲: {width} × {height} px — ハンドルをドラッグして微調整できます'],
    resolveCropFirst: ['Apply (Enter) or cancel (Esc) the crop selection first', '先に切り抜きを適用（Enter）またはキャンセル（Esc）してください'],
    finishDrawingFirst: ['Release the pointer to finish drawing first', '描画操作を完了してから実行してください'],
    saveDisabledByPolicy: ['Saving files to disk is disabled by system policy.', 'システム設定によりディスクへのファイル保存が無効になっています。'],
    addText: ['Add text', '文字を追加'],
    textPlaceholder: ['Ctrl+Enter to add • Enter for new line', 'Ctrl+Enter で追加 • Enter で改行'],
    copied: ['Copied to clipboard', 'クリップボードにコピーしました'],
    copyFailed: ['Could not copy the image to the clipboard.', '画像をクリップボードにコピーできませんでした。'],
    saved: ['Saved', '保存しました'],
    savedAs: ['Saved as {name}', '{name} として保存しました'],
    clearedToast: ['Cleared annotations (Ctrl+Z to undo)', '注釈を消去しました（Ctrl+Z で戻せます）'],
    openFailed: ['The image could not be opened.', '画像を開けませんでした。'],
    saveFailed: ['The image could not be saved.', '画像を保存できませんでした。'],
    localFilesOnly: ['Only local files on this computer are supported.', 'このコンピューター上のローカルファイルのみ対応しています。'],
    emptyHistory: ['Your recent captures appear here.', '最近撮影した画像がここに表示されます。'],
    strokeWidth: ['Stroke width', '線の太さ'],
    mosaicBlockSize: ['Mosaic block size', 'モザイクの粗さ'],
    sizeThin: ['Thin', '細'],
    sizeMedium: ['Medium', '中'],
    sizeThick: ['Thick', '太'],
    sizeExtra: ['Extra', '極太'],
    color: ['Pick custom color…', 'カスタムカラーを選択…'],
    colorRed: ['Red', '赤'],
    colorYellow: ['Yellow', '黄'],
    colorGreen: ['Green', '緑'],
    colorBlue: ['Blue', '青'],
    colorWhite: ['White', '白'],
    colorBlack: ['Black', '黒'],
    zoomIn: ['Zoom in (Ctrl++)', '拡大 (Ctrl++)'],
    zoomOut: ['Zoom out (Ctrl+-)', '縮小 (Ctrl+-)'],
    fit: ['Fit to window (Ctrl+0)', 'ウィンドウに合わせる (Ctrl+0)'],
    actualSize: ['Actual size 100% (Ctrl+1)', '原寸 100% (Ctrl+1)'],
    fitLabel: ['Fit', '自動'],
    unsavedHeading: ['Save changes?', '変更を保存しますか？'],
    unsavedBody: ['Your edits to this screenshot have not been saved yet.', 'このスクリーンショットへの編集内容がまだ保存されていません。'],
    discard: ['Discard', '破棄'],
    saveChanges: ['Save', '保存'],
    applyCropAndSave: ['Apply crop & Save', '切り抜いて保存'],
    overwriteConfirmHeading: ['Replace existing file?', '既存のファイルを上書きしますか？'],
    overwriteConfirmBody: ['"{name}" already exists. Do you want to replace it?', '「{name}」は既に存在します。上書きしてもよろしいですか？'],
    overwrite: ['Replace', '上書き'],
    fileChangedHeading: ['File changed on disk', 'ファイルが外部で更新されました'],
    fileChangedBody: ['This file was modified by another window or app. Choose whether to save as a new copy, overwrite it, or reload.', 'このファイルは別のウィンドウやアプリによって変更されています。別名で保存するか、上書き、または再読み込みを選んでください。'],
    reload: ['Reload', '再読み込み'],
    temporaryBadge: ['Temporary', '一時保存'],
    imageFilterName: ['Images (PNG, JPEG, WebP, SVG)', '画像ファイル (PNG, JPEG, WebP, SVG)'],
    pngFilterName: ['PNG image', 'PNG 画像'],
    justNow: ['Just now', 'たった今'],
    minutesAgo: ['{n}m ago', '{n}分前'],
    hoursAgo: ['{n}h ago', '{n}時間前'],
    yesterday: ['Yesterday', '昨日'],
    modifiedBadge: ['Unsaved', '未保存'],
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
