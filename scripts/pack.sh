#!/bin/sh
# SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
uuid='simple-screenshot@local'
build_dir="$project_dir/dist"
archive="$build_dir/$uuid.shell-extension.zip"

mkdir -p "$build_dir"
gnome-extensions pack --force --out-dir "$build_dir" \
    --extra-source=capture.js \
    --extra-source=geometry.js \
    --extra-source=i18n.js \
    --extra-source=indicator.js \
    --extra-source=overlay.js \
    --extra-source=editor \
    "$project_dir/extension"

zip -q -j "$archive" \
    "$project_dir/LICENSE" \
    "$project_dir/LICENSE-APACHE" \
    "$project_dir/LICENSE-GPL" \
    "$project_dir/NOTICE"
