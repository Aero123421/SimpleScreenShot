#!/bin/sh
# SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
set -eu

uuid='simple-screenshot@local'
extension_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
desktop_file="${XDG_DATA_HOME:-$HOME/.local/share}/applications/io.github.simple_screenshot.Editor.desktop"

disabled=0
if gnome-extensions disable "$uuid" 2>/dev/null; then
    disabled=1
fi

if gnome-extensions uninstall "$uuid" 2>/dev/null; then
    printf '%s\n' "Uninstalled $uuid via gnome-extensions."
elif [ -e "$extension_dir" ]; then
    gio trash "$extension_dir"
    printf '%s\n' "Moved $extension_dir to Trash."
    if [ "$disabled" -eq 0 ]; then
        printf '%s\n' 'Log out and back in to unload the extension from the active GNOME Shell session.'
    fi
fi

if [ -e "$desktop_file" ]; then
    gio trash "$desktop_file"
    printf '%s\n' "Moved $desktop_file to Trash."
fi
