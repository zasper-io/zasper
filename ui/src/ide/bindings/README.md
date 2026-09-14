# Keyboard shortcuts

The shortcuts Zasper has are the ones its commands declare, in
[`src/commands`](../../commands). The **Help** tab lists every one with the keys for the platform it is
running on, and the command palette (Ctrl+Shift+P, or Cmd+Shift+P on macOS) shows each command's
shortcut beside it. Both are generated from the registry, so they cannot fall out of date the way a
hand-written table does.

This file used to be a copy of VS Code's shortcuts, and most of what it listed — go to definition, find
references, rename, debugging, global search and replace — does not exist in Zasper yet. Those are
planned as part of the file editor's language intelligence and project search; a shortcut is added to a
command when the command is.
