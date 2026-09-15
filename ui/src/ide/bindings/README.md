# Keyboard shortcuts

The shortcuts Zasper has are the ones its commands declare, in
[`src/commands`](../../commands). The **Help** tab lists every one with the keys for the platform it is
running on, and the command palette (Ctrl+Shift+P, or Cmd+Shift+P on macOS) shows each command's
shortcut beside it. Both are generated from the registry, so they cannot fall out of date the way a
hand-written table does.

This file used to be a copy of VS Code's shortcuts, and most of what it listed — go to definition, find
references, rename, debugging — does not exist in Zasper yet; a shortcut is added to a command when the
command is. Search and replace across the project is Search in Files (Ctrl+Shift+F, or Cmd+Shift+F on
macOS). With a language server running, Go to Definition is F12 and Format Document is Shift+Alt+F, both
bound in the file editor itself.
