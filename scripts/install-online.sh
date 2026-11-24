#!/bin/sh
# SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
set -eu

repository='Aero123421/SimpleScreenShot'
uuid='simple-screenshot@local'
archive_name="$uuid.shell-extension.zip"
checksum_name="$archive_name.sha256"
requested_version="${SIMPLE_SCREENSHOT_VERSION:-latest}"

escape_desktop_exec_arg() {
    # Desktop Entry spec: Exec quoted arg requires two escaping layers for backslash (\\ -> \\\\).
    printf '%s' "$1" | sed -e 's/\\/\\\\\\\\/g' -e 's/"/\\"/g' -e 's/\$/\\$/g' -e 's/`/\\`/g' -e 's/%/%%/g'
}

for command_name in curl sha256sum unzip gnome-extensions gnome-shell gjs; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        printf '%s\n' "Required command not found: $command_name" >&2
        printf '%s\n' 'Simple ScreenShot currently supports Ubuntu 24.04 with GNOME 46.' >&2
        exit 1
    fi
done

shell_major=$(gnome-shell --version | awk '{split($3, version, "."); print version[1]}')
if [ "$shell_major" != '46' ]; then
    printf '%s\n' "Unsupported GNOME Shell version: $shell_major" >&2
    printf '%s\n' 'This release supports GNOME Shell 46 only.' >&2
    exit 1
fi

if [ "$requested_version" = 'latest' ]; then
    release_base="https://github.com/$repository/releases/latest/download"
else
    release_base="https://github.com/$repository/releases/download/$requested_version"
fi

download_dir=$(mktemp -d)
cleanup() {
    rm -f "$download_dir/$archive_name" "$download_dir/$checksum_name"
    rmdir "$download_dir" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

printf '%s\n' "Downloading Simple ScreenShot ($requested_version)…"
curl --proto '=https' --tlsv1.2 -fsSL \
    "$release_base/$archive_name" -o "$download_dir/$archive_name"
curl --proto '=https' --tlsv1.2 -fsSL \
    "$release_base/$checksum_name" -o "$download_dir/$checksum_name"

(
    cd "$download_dir"
    sha256sum -c "$checksum_name"
)

gnome-extensions install --force "$download_dir/$archive_name"

extension_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
applications_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
desktop_file="$applications_dir/io.github.simple_screenshot.Editor.desktop"
mkdir -p "$applications_dir"

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

printf '\n%s\n' 'Simple ScreenShot was installed successfully.'
if gnome-extensions enable "$uuid" 2>/dev/null; then
    printf '%s\n' 'Enabled in GNOME Shell settings. Press Shift + Super + S (log out and back in once if newly installed).'
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
        printf '%s\n' 'Use Shift + Super + S after logging out and back in once.'
    else
        printf '%s\n' 'Installed, but could not enable automatically. Enable Simple ScreenShot in the Extensions app.' >&2
    fi
fi
