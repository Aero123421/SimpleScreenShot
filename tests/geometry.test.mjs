// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import assert from 'node:assert/strict';

import {
    clampCaptureGeometry,
    constrainEndPoint,
    containsPoint,
    cropHandleAt,
    formatFilenamePattern,
    intersection,
    normalizeRect,
    normalizeRectFloat,
    rectForPoint,
    resizeRectByHandle,
    sanitizeFilename,
    selectLanguage,
    suggestedPngName,
} from '../extension/geometry.js';

assert.deepEqual(
    normalizeRect(40, 80, 10, 20),
    {x: 10, y: 20, width: 30, height: 60});

assert.deepEqual(
    normalizeRect(-10, -5, 120, 80, {x: 0, y: 0, width: 100, height: 60}),
    {x: 0, y: 0, width: 100, height: 60});

// Edge rounding without independent origin+width drift (0.5..100 -> 1..100, width 99)
assert.deepEqual(
    normalizeRect(0.5, 0.5, 100, 100),
    {x: 1, y: 1, width: 99, height: 99});

assert.equal(containsPoint({x: 10, y: 10, width: 20, height: 20}, 29, 29), true);
assert.equal(containsPoint({x: 10, y: 10, width: 20, height: 20}, 30, 30), false);

assert.deepEqual(
    intersection(
        {x: 0, y: 0, width: 100, height: 100},
        {x: 60, y: 50, width: 80, height: 20}),
    {x: 60, y: 50, width: 40, height: 20});

assert.deepEqual(
    rectForPoint([
        {x: 0, y: 0, width: 40, height: 40, id: 'first'},
        {x: 40, y: 0, width: 40, height: 40, id: 'second'},
    ], 55, 12),
    {x: 40, y: 0, width: 40, height: 40, id: 'second'});

// Filename sanitization: leading spaces + dots (including repeated groups), multibyte byte budget
assert.equal(sanitizeFilename('  Screenshot: 12/30?  '), 'Screenshot- 12-30-');
assert.equal(sanitizeFilename('...'), 'Screenshot');
assert.equal(sanitizeFilename('  .private  '), 'private');
assert.equal(sanitizeFilename(' . . .name '), 'name');
const longJa = sanitizeFilename('スクリーンショット'.repeat(30));
assert.ok(new TextEncoder().encode(longJa).length <= 180);
assert.ok(longJa.length > 0);

// Suggested PNG name strips imported extensions cleanly
assert.equal(suggestedPngName('fixture.svg'), 'fixture.png');
assert.equal(suggestedPngName('photo.jpeg'), 'photo.png');
assert.equal(suggestedPngName('capture.png'), 'capture.png');
assert.equal(suggestedPngName('report'), 'report.png');

// Locale selection follows user preference order
assert.equal(selectLanguage(['en_US', 'ja_JP']), 'en');
assert.equal(selectLanguage(['ja_JP', 'en_US']), 'ja');
assert.equal(selectLanguage(['fr_FR', 'ja']), 'ja');
assert.equal(selectLanguage(['C']), 'en');

// Filename pattern formatting
assert.equal(
    formatFilenamePattern('Snap {date}_{time}', {
        year: '2026', month: '11', day: '24',
        hour: '13', minute: '05', second: '09',
    }),
    'Snap 2026-11-24_13-05-09'
);
assert.equal(
    formatFilenamePattern('', {
        year: '2026', month: '11', day: '24',
        hour: '13', minute: '05', second: '09',
    }),
    'Screenshot 2026-11-24 13-05-09'
);

// End-to-end fractional drag -> texture-space clamp
const dragged = normalizeRectFloat(100.4, 50, 1536, 864.4, {x: 0, y: 0, width: 1536, height: 864});
assert.deepEqual(
    clampCaptureGeometry(dragged, 1.25, 1920, 1080),
    [126, 63, 1794, 1017]
);
assert.deepEqual(
    clampCaptureGeometry({x: -10, y: -5, width: 50, height: 40}, 1, 100, 100),
    [0, 0, 40, 35]
);
// Wholly disjoint rectangle must return null instead of fabricating a 1px strip
assert.equal(
    clampCaptureGeometry({x: 200, y: 200, width: 50, height: 50}, 1, 100, 100),
    null
);

// Shift-constrained square/circle and 45-degree arrow snapping, including edge clamping
const cropBounds = {x: 0, y: 0, width: 100, height: 80};
assert.deepEqual(
    constrainEndPoint({x: 10, y: 10}, {x: 60, y: 30}, 'square', cropBounds),
    {x: 60, y: 60}
);
// Near bottom edge (only 20px left in Y): must stay a 20x20 square instead of squishing!
assert.deepEqual(
    constrainEndPoint({x: 10, y: 60}, {x: 90, y: 120}, 'square', cropBounds),
    {x: 30, y: 80}
);
const snapped45Bounded = constrainEndPoint({x: 50, y: 60}, {x: 120, y: 130}, 'angle45', cropBounds);
assert.ok(Math.abs((snapped45Bounded.x - 50) - (snapped45Bounded.y - 60)) < 1e-6);
assert.ok(snapped45Bounded.y <= 80 + 1e-6);

// Interactive crop handles: nearest handle wins even when hit radii overlap at low zoom
const smallCrop = {x: 100, y: 100, width: 16, height: 16};
assert.equal(cropHandleAt(smallCrop, 116, 116, 20), 'se');
assert.equal(cropHandleAt(smallCrop, 100, 100, 20), 'nw');
assert.equal(cropHandleAt(smallCrop, 108, 100, 20), 'n');

const cropRect = {x: 100, y: 100, width: 200, height: 150};
const bounds = {x: 0, y: 0, width: 500, height: 400};
assert.equal(cropHandleAt(cropRect, 200, 175, 10), 'move');
assert.equal(cropHandleAt(cropRect, 10, 10, 10), null);

assert.deepEqual(
    resizeRectByHandle(cropRect, 'se', 50, 40, bounds),
    {x: 100, y: 100, width: 250, height: 190}
);
assert.deepEqual(
    resizeRectByHandle(cropRect, 'nw', 250, 200, bounds, 20),
    {x: 280, y: 230, width: 20, height: 20}
);
assert.deepEqual(
    resizeRectByHandle(cropRect, 'move', 400, 300, bounds),
    {x: 300, y: 250, width: 200, height: 150}
);

console.log('geometry tests passed');
