// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function parseStringCatalog(path) {
    const source = readFileSync(path, 'utf8');
    const match = source.match(/export const strings = (\{[\s\S]*?\n\});/);
    assert.ok(match, `Missing exported strings catalog in ${path}`);
    const catalog = new Function(`return (${match[1]});`)();
    for (const [key, pair] of Object.entries(catalog)) {
        assert.ok(
            Array.isArray(pair) && pair.length === 2,
            `${path}: key "${key}" must map to [en, ja]`
        );
        assert.ok(
            typeof pair[0] === 'string' && pair[0].trim().length > 0,
            `${path}: key "${key}" is missing English text`
        );
        assert.ok(
            typeof pair[1] === 'string' && pair[1].trim().length > 0,
            `${path}: key "${key}" is missing Japanese text`
        );
    }
    return catalog;
}

function assertReferencedKeysExist(files, catalog, catalogName) {
    const pattern = /\bt\(\s*'([^']+)'/g;
    for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(pattern)) {
            const key = match[1];
            assert.ok(
                Object.hasOwn(catalog, key),
                `${file}: missing i18n key "${key}" in ${catalogName}`
            );
        }
    }
}

function assertDynamicKeysExist(keys, catalog, catalogName) {
    for (const key of keys) {
        assert.ok(
            Object.hasOwn(catalog, key),
            `Missing dynamic i18n key "${key}" in ${catalogName}`
        );
    }
}

const extensionCatalog = parseStringCatalog('extension/i18n.js');
const editorCatalog = parseStringCatalog('extension/editor/i18n.js');

assertReferencedKeysExist(
    [
        'extension/extension.js',
        'extension/overlay.js',
        'extension/indicator.js',
        'extension/prefs.js',
    ],
    extensionCatalog,
    'extension/i18n.js'
);

assertReferencedKeysExist(
    [
        'extension/editor/window.js',
        'extension/editor/canvas.js',
        'extension/editor/application.js',
    ],
    editorCatalog,
    'extension/editor/i18n.js'
);

// Dynamic keys referenced via mode/tool/swatch/size tables
assertDynamicKeysExist(
    ['region', 'window', 'screen'],
    extensionCatalog,
    'extension/i18n.js'
);
assertDynamicKeysExist(
    [
        'pen', 'highlighter', 'arrow', 'rectangle', 'ellipse', 'text', 'mosaic', 'crop',
        'colorRed', 'colorYellow', 'colorGreen', 'colorBlue', 'colorWhite', 'colorBlack',
        'sizeThin', 'sizeMedium', 'sizeThick', 'sizeExtra',
    ],
    editorCatalog,
    'extension/editor/i18n.js'
);

console.log('i18n tests passed');
