#!/bin/sh
# SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work_dir=$(mktemp -d)
cleanup() {
    rm -rf "$work_dir"
}
trap cleanup EXIT HUP INT TERM

cd "$project_dir"

glib-compile-schemas --strict --dry-run extension/schemas

for file in $(find extension -name '*.js' -type f | sort); do
    node --check "$file"
done

node tests/geometry.test.mjs
node tests/keybinding.test.mjs
node tests/i18n.test.mjs
gjs -m extension/editor/main.js --self-test tests/fixture.svg "$work_dir/editor-out.png"

sh scripts/pack.sh >/dev/null

archive='dist/simple-screenshot@local.shell-extension.zip'
archive_entries="$work_dir/entries.txt"
unzip -Z1 "$archive" > "$archive_entries"

for required in \
    metadata.json \
    extension.js \
    capture.js \
    geometry.js \
    i18n.js \
    indicator.js \
    overlay.js \
    prefs.js \
    stylesheet.css \
    schemas/org.gnome.shell.extensions.simple-screenshot.gschema.xml \
    editor/main.js \
    editor/application.js \
    editor/canvas.js \
    editor/window.js \
    editor/history.js \
    editor/i18n.js \
    editor/style.css \
    editor/icons/hicolor/scalable/actions/ss-pen-symbolic.svg \
    editor/icons/hicolor/scalable/actions/ss-highlighter-symbolic.svg \
    editor/icons/hicolor/scalable/actions/ss-arrow-symbolic.svg \
    editor/icons/hicolor/scalable/actions/ss-rectangle-symbolic.svg \
    editor/icons/hicolor/scalable/actions/ss-ellipse-symbolic.svg \
    editor/icons/hicolor/scalable/actions/ss-text-symbolic.svg \
    editor/icons/hicolor/scalable/actions/ss-mosaic-symbolic.svg \
    editor/icons/hicolor/scalable/actions/ss-crop-symbolic.svg \
    LICENSE \
    LICENSE-APACHE \
    LICENSE-GPL \
    NOTICE; do
    if ! grep -F -x -q -- "$required" "$archive_entries"; then
        printf '%s\n' "Missing packaged source: $required" >&2
        exit 1
    fi
done

# Verify the packaged archive itself compiles schemas and runs cleanly from a path with spaces.
extracted_dir="$work_dir/extracted extension"
mkdir -p "$extracted_dir"
unzip -q "$archive" -d "$extracted_dir"
glib-compile-schemas --strict "$extracted_dir/schemas"
gjs -m "$extracted_dir/editor/main.js" --self-test tests/fixture.svg "$work_dir/packaged-out.png" >/dev/null

printf '%s\n' 'All checks passed.'
