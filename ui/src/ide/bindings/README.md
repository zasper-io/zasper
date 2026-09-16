# Keyboard shortcuts

The shortcuts Zasper has are the ones its commands declare, in
[`src/commands`](../../commands). The **Help** tab lists every one with the keys for the platform it is
running on, and the command palette (Ctrl+Shift+P, or Cmd+Shift+P on macOS) shows each command's
shortcut beside it. Both are generated from the registry, so they cannot fall out of date the way a
hand-written table does.

This file used to be a copy of VS Code's shortcuts, and most of what it listed did not exist in Zasper; a
shortcut is added to a command when the command is. Debugging still does not exist. Search and replace
across the project is Search in Files (Ctrl+Shift+F, or Cmd+Shift+F on macOS).

With a language server running, the file editor answers for the name under the cursor: Go to Definition is
F12, Find All References Shift+F12, Rename Symbol F2, Quick Fix Ctrl+. (Cmd+. on macOS), and Format
Document Shift+Alt+F. Definition and formatting are bound by the language server client inside the
editor; the other three are commands, so they are in the palette and the Help tab as well. The palette
also answers `@` with the symbols of the file in front and `#` with a symbol anywhere in the project.
