// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later

import GLib from 'gi://GLib';

export class HistoryStore {
    constructor() {
        this.path = GLib.build_filenamev([
            GLib.get_user_data_dir(), 'simple-screenshot', 'history.json',
        ]);
    }

    entries() {
        try {
            const [ok, contents] = GLib.file_get_contents(this.path);
            if (!ok)
                return [];
            const parsed = JSON.parse(new TextDecoder().decode(contents));
            if (!Array.isArray(parsed))
                return [];
            return parsed.filter(entry => entry && typeof entry.path === 'string');
        } catch (_error) {
            return [];
        }
    }
}
