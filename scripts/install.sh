#!/bin/sh
# SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
uuid='simple-screenshot@local'
archive="$project_dir/dist/$uuid.shell-extension.zip"
extension_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
applications_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
desktop_file="$applications_dir/io.github.simple_screenshot.Editor.desktop"

escape_desktop_exec_arg() {
    # Desktop Entry spec: Exec quoted arg requires two escaping layers for backslash (\\ -> \\\\).
    printf '%s' "$1" | sed -e 's/\\/\\\\\\\\/g' -e 's/"/\\"/g' -e 's/\$/\\$/g' -e 's/`/\\`/g' -e 's/%/%%/g'
}

mkdir -p "$applications_dir"
if [ ! -f "$archive" ]; then
    sh "$project_dir/scripts/pack.sh"
fi
gnome-extensions install --force "$archive"

escaped_entry=$(escape_desktop_exec_arg "$extension_dir/editor/main.js")
{
    printf '%s\n' '[Desktop Entry]'
    printf '%s\n' 'Name=Simple ScreenShot Editor'
    printf '%s\n' 'Name[ja]=Simple ScreenShot エディタ'
    printf '%s\n' 'Comment=Annotate and share recent screenshots'
    printf '%s\n' 'Comment[ja]=スクリーンショットへ注釈を付けて共有します'
    printf 'Exec=gjs -m "%s"\n' "$escaped_entry"
    printf '%s\n' 'Icon=camera-photo-symbolic'
    printf '%s\n' 'Terminal=false'
    printf '%s\n' 'Type=Application'
    printf '%s\n' 'Categories=Graphics;2DGraphics;'
    printf '%s\n' 'Keywords=screenshot;snip;capture;annotation;'
    printf '%s\n' 'StartupNotify=true'
} > "$desktop_file"

update-desktop-database "$applications_dir" 2>/dev/null || true

printf '%s\n' "Installed $uuid to $extension_dir"
if gnome-extensions enable "$uuid" 2>/dev/null; then
    printf '%s\n' "Enabled $uuid in GNOME Shell settings. If not active yet, log out and back in once."
else
    if gjs -c "
        const Gio = imports.gi.Gio;
        const s = new Gio.Settings({schema_id: 'org.gnome.shell'});
        const uuid = '$uuid';
        const enabled = s.get_strv('enabled-extensions');
        let ok = true;
        if (!enabled.includes(uuid)) {
            enabled.push(uuid);
            ok = s.set_strv('enabled-extensions', enabled) && ok;
        }
        const disabled = s.get_strv('disabled-extensions').filter(id => id !== uuid);
        ok = s.set_strv('disabled-extensions', disabled) && ok;
        Gio.Settings.sync();
        if (!ok) throw new Error('Failed to write GNOME Shell extension settings');
    "; then
        printf '%s\n' 'Queued extension for activation; log out and back in once to load it.'
    else
        printf '%s\n' 'Extension installed, but could not enable it automatically. Enable it in the Extensions app.' >&2
    fi
fi
