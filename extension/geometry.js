// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

const MAX_FILENAME_BYTES = 180;
const utf8Encoder = new TextEncoder();

export function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeRectFloat(x1, y1, x2, y2, bounds = null) {
    let left = Math.min(x1, x2);
    let top = Math.min(y1, y2);
    let right = Math.max(x1, x2);
    let bottom = Math.max(y1, y2);

    if (bounds) {
        left = clamp(left, bounds.x, bounds.x + bounds.width);
        top = clamp(top, bounds.y, bounds.y + bounds.height);
        right = clamp(right, bounds.x, bounds.x + bounds.width);
        bottom = clamp(bottom, bounds.y, bounds.y + bounds.height);
    }

    return {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
}

export function normalizeRect(x1, y1, x2, y2, bounds = null) {
    const raw = normalizeRectFloat(x1, y1, x2, y2, bounds);
    const left = Math.round(raw.x);
    const top = Math.round(raw.y);
    const right = Math.round(raw.x + raw.width);
    const bottom = Math.round(raw.y + raw.height);

    return {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
}

export function containsPoint(rect, x, y) {
    return x >= rect.x && y >= rect.y &&
        x < rect.x + rect.width && y < rect.y + rect.height;
}

export function intersection(first, second) {
    const x = Math.max(first.x, second.x);
    const y = Math.max(first.y, second.y);
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.height, second.y + second.height);

    return {
        x,
        y,
        width: Math.max(0, right - x),
        height: Math.max(0, bottom - y),
    };
}

export function rectForPoint(rectangles, x, y) {
    return rectangles.find(rect => containsPoint(rect, x, y)) ?? null;
}

function truncateUtf8Bytes(text, maxBytes) {
    if (utf8Encoder.encode(text).length <= maxBytes)
        return text;

    let result = '';
    let used = 0;
    for (const ch of text) {
        const size = utf8Encoder.encode(ch).length;
        if (used + size > maxBytes)
            break;
        result += ch;
        used += size;
    }
    return result.trim();
}

export function sanitizeFilename(value) {
    const cleaned = String(value ?? '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.]+/, '')
        .trim();
    const bounded = truncateUtf8Bytes(cleaned, MAX_FILENAME_BYTES)
        .replace(/^[\s.]+/, '')
        .trim();
    return bounded || 'Screenshot';
}

export function formatFilenamePattern(pattern, parts) {
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}-${parts.minute}-${parts.second}`;
    const replacements = {
        '{date}': date,
        '{time}': time,
        '{timestamp}': `${date} ${time}`,
    };
    let result = String(pattern || 'Screenshot {timestamp}');
    for (const [token, value] of Object.entries(replacements))
        result = result.replaceAll(token, value);
    return sanitizeFilename(result);
}

export function suggestedPngName(basename) {
    const raw = String(basename ?? '').trim();
    if (!raw)
        return 'Screenshot.png';
    const stripped = raw.replace(/\.(png|jpe?g|webp|svg|bmp|gif|tiff?)$/i, '');
    return `${sanitizeFilename(stripped || 'Screenshot')}.png`;
}

export function selectLanguage(languageNames) {
    for (const raw of languageNames ?? []) {
        const lower = String(raw).toLowerCase();
        if (lower === 'ja' || lower.startsWith('ja_') || lower.startsWith('ja-'))
            return 'ja';
        if (lower === 'en' || lower.startsWith('en_') || lower.startsWith('en-') ||
            lower === 'c' || lower === 'posix')
            return 'en';
    }
    return 'en';
}

export function clampCaptureGeometry(geometry, scale, textureWidth, textureHeight) {
    const maxW = Math.floor(textureWidth);
    const maxH = Math.floor(textureHeight);
    if (maxW <= 0 || maxH <= 0 || !geometry || geometry.width <= 0 || geometry.height <= 0)
        return null;

    const rawLeft = geometry.x * scale;
    const rawTop = geometry.y * scale;
    const rawRight = (geometry.x + geometry.width) * scale;
    const rawBottom = (geometry.y + geometry.height) * scale;

    if (rawRight <= 0 || rawBottom <= 0 || rawLeft >= maxW || rawTop >= maxH)
        return null;

    const left = clamp(Math.round(rawLeft), 0, maxW);
    const top = clamp(Math.round(rawTop), 0, maxH);
    const right = clamp(Math.round(rawRight), 0, maxW);
    const bottom = clamp(Math.round(rawBottom), 0, maxH);

    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0)
        return null;

    return [left, top, width, height];
}

export function constrainEndPoint(start, end, mode, bounds = null) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (mode === 'square') {
        const signX = dx < 0 ? -1 : 1;
        const signY = dy < 0 ? -1 : 1;
        let size = Math.max(Math.abs(dx), Math.abs(dy));
        if (bounds) {
            const maxDx = signX > 0
                ? (bounds.x + bounds.width) - start.x
                : start.x - bounds.x;
            const maxDy = signY > 0
                ? (bounds.y + bounds.height) - start.y
                : start.y - bounds.y;
            size = Math.min(size, Math.max(0, maxDx), Math.max(0, maxDy));
        }
        return {
            x: start.x + signX * size,
            y: start.y + signY * size,
        };
    }

    if (mode === 'angle45') {
        let length = Math.hypot(dx, dy);
        if (length === 0)
            return {x: start.x, y: start.y};
        const step = Math.PI / 4;
        const angle = Math.round(Math.atan2(dy, dx) / step) * step;
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        if (bounds) {
            let maxLen = length;
            if (Math.abs(ux) > 1e-9) {
                const limitX = ux > 0 ? bounds.x + bounds.width : bounds.x;
                maxLen = Math.min(maxLen, Math.max(0, (limitX - start.x) / ux));
            }
            if (Math.abs(uy) > 1e-9) {
                const limitY = uy > 0 ? bounds.y + bounds.height : bounds.y;
                maxLen = Math.min(maxLen, Math.max(0, (limitY - start.y) / uy));
            }
            length = maxLen;
        }
        return {
            x: start.x + ux * length,
            y: start.y + uy * length,
        };
    }

    return {x: end.x, y: end.y};
}

export function cropHandleAt(rect, x, y, radius = 10) {
    if (!rect)
        return null;

    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;
    const midX = left + rect.width / 2;
    const midY = top + rect.height / 2;

    const handles = [
        ['nw', left, top],
        ['ne', right, top],
        ['sw', left, bottom],
        ['se', right, bottom],
        ['n', midX, top],
        ['s', midX, bottom],
        ['w', left, midY],
        ['e', right, midY],
    ];

    let bestHandle = null;
    let bestDistance = radius;
    for (const [name, hx, hy] of handles) {
        const distance = Math.hypot(x - hx, y - hy);
        if (distance <= bestDistance) {
            bestDistance = distance;
            bestHandle = name;
        }
    }

    if (bestHandle)
        return bestHandle;

    if (containsPoint(rect, x, y))
        return 'move';

    return null;
}

export function resizeRectByHandle(rect, handle, dx, dy, bounds, minSize = 12) {
    const minW = Math.min(minSize, bounds.width);
    const minH = Math.min(minSize, bounds.height);
    const minX = bounds.x;
    const minY = bounds.y;
    const maxX = bounds.x + bounds.width;
    const maxY = bounds.y + bounds.height;

    if (handle === 'move') {
        const x = clamp(Math.round(rect.x + dx), minX, maxX - rect.width);
        const y = clamp(Math.round(rect.y + dy), minY, maxY - rect.height);
        return {x, y, width: rect.width, height: rect.height};
    }

    let left = rect.x;
    let top = rect.y;
    let right = rect.x + rect.width;
    let bottom = rect.y + rect.height;

    if (handle.includes('w'))
        left = clamp(Math.round(left + dx), minX, right - minW);
    if (handle.includes('e'))
        right = clamp(Math.round(right + dx), left + minW, maxX);
    if (handle.includes('n'))
        top = clamp(Math.round(top + dy), minY, bottom - minH);
    if (handle.includes('s'))
        bottom = clamp(Math.round(bottom + dy), top + minH, maxY);

    return {
        x: left,
        y: top,
        width: Math.max(minW, right - left),
        height: Math.max(minH, bottom - top),
    };
}
