# Changelog

All notable changes to Simple ScreenShot are documented here.

## [0.2.0] - 2026-11-24

Major UI/UX refresh and reliability release.

### Added

- Custom symbolic SVG icons for all 8 annotation tools, consistent across both Yaru and Adwaita icon themes.
- Ellipse/circle annotation tool, single-point pen dots, and Shift-constrained shapes (squares, circles, and 45° arrows).
- Interactive 8-handle crop adjustment with interior dragging, rule-of-thirds guides, live dimension badge, and non-jumping confirmation bar.
- Quick-access 6-color swatch palette plus custom color picker with live swatch indicator.
- Inline canvas text input popover powered by PangoCairo with full Japanese/CJK multi-line support, contrasting text halo, and IME-safe `Ctrl + Enter` submission.
- True scrollable zoom (`Ctrl + Wheel`, `Ctrl + +`/`-`/`0`/`1`) and middle-button drag panning.
- Unsaved-changes confirmation dialog, concurrent-edit ETag conflict protection, undoable clear-all annotations, open-image dialog (`Ctrl + O`), drag-and-drop image loading, and empty state guidance.
- Full Japanese and English localization across Preferences, including live filename pattern preview and one-click reset buttons.
- System policy support for `org.gnome.desktop.lockdown` (`disable-save-to-disk`).

### Changed

- Migrated the GTK4/Libadwaita editor to semantic Libadwaita theme tokens with full Light and Dark mode adaptation, WCAG AA/AAA text contrast, responsive sidebar collapsing (`Adw.Breakpoint`), and `CONTAIN` history thumbnails that preserve portrait aspect ratios.
- Replaced Cairo `writeToPNG` with in-memory `Gtk.Snapshot` + `Gsk.CairoRenderer` PNG encoding and safe atomic file replacement preserving permissions (`0600`) and symlinks.
- Switched editor clipboard copy to zero-disk-I/O `Gdk.ContentProvider` (`image/png`) and asynchronous GIO disk/history I/O in the GNOME Shell extension.
- Switched mosaic rendering to composited Pure Cairo sampling with `BILINEAR` downscale and `SOURCE` compositing so prior annotations and transparent PNGs redact cleanly.
- Centralized extension packaging into `scripts/pack.sh` and expanded automated geometry, i18n, pixel-level export, permission/symlink, and window smoke tests.

### Fixed

- Fixed overlay toolbar and hint straddling monitor bezels on multi-monitor setups by constraining overlay chrome to the active monitor inside `Clutter.FixedLayout`.
- Fixed window-mode captures leaking overlapping application pixels or another window's cursor by capturing isolated window textures with top-most cursor ownership.
- Fixed top-panel menu dropdowns occasionally appearing in frozen screenshots, fullscreen apps hiding the overlay, and fractional-scaling edge rounding overflows.
- Fixed non-PNG imports (SVG/JPEG/WebP) and temporary captures being overwritten by `Ctrl + S`, and prevented Copy/Save while a crop or drag gesture is still in progress.
- Fixed GNOME Shell `stylesheet.css` multi-shadow warnings, `.desktop` Exec path escaping for spaces/special characters, and locale fallback priority.

## [0.1.2] - 2026-08-29

### Fixed

- Fixed the capture shortcut being overwritten by Ubuntu Dock because both extensions used the same internal keybinding name.
- Automatically migrate shortcuts saved by versions 0.1.0 and 0.1.1.

## [0.1.1] - 2026-08-26

### Changed

- Replaced raw accelerator text editing with an easy press-to-record shortcut dialog.
- Added clear, cancel, and one-click reset actions for the keyboard shortcut.
- Set the default capture shortcut explicitly to `Shift + Super + S`.

## [0.1.0] - 2026-08-24

Initial public release.

### Added

- Windows-style frozen-screen capture overlay.
- Rectangular, window, and full-screen capture modes.
- Multi-monitor capture, clipboard copy, automatic PNG saving, and notifications.
- GTK4/Libadwaita editor with pen, highlighter, arrow, rectangle, text, mosaic, and crop tools.
- Undo/redo, copy, save, save-as, and recent capture history.
- Preferences for keyboard shortcut, default mode, storage, notifications, pointer inclusion, and panel indicator.
- Japanese and English UI.
- SHA-256-verified one-line installer.
