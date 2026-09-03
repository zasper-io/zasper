/**
 * A single thing the user can ask the IDE to do, declared once and reachable from everywhere:
 * the command palette lists these, the keyboard dispatches them, and toolbar buttons call them
 * by id. Before this existed the same action was written out separately in the toolbar, in a
 * `keydown` handler and in the palette, and the copies drifted apart.
 */
export interface ICommand {
  /** Namespaced and stable — it is what buttons and tests refer to. `notebook:run-cell`. */
  id: string;
  label: string;
  description?: string;
  /** Groups and is searched in the palette. `Notebook`, `View`. */
  category: string;
  /**
   * Chords in CodeMirror's notation: `Mod-s`, `Ctrl-Enter`, `Shift-Enter`. `Mod-` is Cmd on mac
   * and Ctrl elsewhere. One notation for both consumers — the window dispatcher parses these,
   * and `cell-editor` commands hand them to `keymap.of()` unchanged.
   */
  keys?: string[];
  scope: CommandScope;
  /** Absent means always enabled. A disabled command still shows in the palette, dimmed. */
  isEnabled?: () => boolean;
  execute: () => void;
}

/**
 * Which dispatcher owns the command's keys. Not *when* it is available — that is decided by
 * whether it is registered at all, and only the active tab registers.
 *
 * - `app` / `notebook`: the window dispatcher (`useCommandKeymap`). A cell's editor does not
 *   stop propagation of chords it has no binding for, so these still fire while typing.
 * - `cell-editor`: contributed into the cell's CodeMirror keymap at `Prec.highest`, for chords
 *   CodeMirror would otherwise swallow — `Shift-Enter` inserts a newline by default.
 */
export type CommandScope = 'app' | 'notebook' | 'cell-editor';
