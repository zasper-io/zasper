import { useMemo, useRef } from 'react';
import { closeCompletion } from '@codemirror/autocomplete';
import { Prec, type Extension } from '@codemirror/state';
import { keymap, type KeyBinding, type EditorView } from '@codemirror/view';

import { trackCommand } from '@/telemetry';

import { ICommand } from './types';

/**
 * Turns the `cell-editor` commands out of `commands` into a CodeMirror extension.
 *
 * These cannot go through the window dispatcher: CodeMirror binds `Shift-Enter` and `Ctrl-Enter`
 * itself and would insert a newline before the event ever reached the window. `Prec.highest` is
 * what puts them ahead of those defaults.
 *
 * The returned extension is stable as long as the ids and their chords are, even though the
 * command bodies are rebuilt on every keystroke: each binding looks its command up again when the
 * key is actually pressed. That matters because `@uiw/react-codemirror` tears down and rebuilds
 * the editor's configuration whenever the extensions it is handed change identity — a fresh
 * extension per render would drop the completion popup mid-word.
 */
export function useEditorCommandKeymap(commands: ICommand[]): Extension {
  const latest = useRef(commands);
  latest.current = commands;

  const signature = commands
    .filter((command) => command.scope === 'cell-editor')
    .map((command) => `${command.id}\0${command.keys?.join(' ')}`)
    .join('\n');

  return useMemo(() => {
    const bindings: KeyBinding[] = [];

    for (const command of latest.current) {
      if (command.scope !== 'cell-editor' || !command.keys) {
        continue;
      }
      const { id } = command;
      const run = (view: EditorView) => {
        const current = latest.current.find((candidate) => candidate.id === id);
        if (!current || (current.isEnabled && !current.isEnabled())) {
          // Returning false hands the chord back to CodeMirror, so a disabled command leaves the
          // editor's own binding working rather than swallowing the key.
          return false;
        }
        // A completion list open when the cell is run is answering a question that has been asked
        // and left: nothing closed it, so it stayed on screen over the *next* cell for as long as
        // the run took. CodeMirror only dismisses it on Escape or on a change to the document.
        closeCompletion(view);
        // As well as in the registry, because this path bypasses it: NotebookEditor hands the raw
        // commands here, so run-cell and run-cell-and-advance would otherwise never be counted.
        trackCommand(id);
        current.execute();
        return true;
      };
      for (const key of command.keys) {
        bindings.push({ key, run });
      }
    }

    return Prec.highest(keymap.of(bindings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
