import { useMemo, useRef } from 'react';
import { closeCompletion } from '@codemirror/autocomplete';
import { Prec, type Extension } from '@codemirror/state';
import { keymap, type KeyBinding, type EditorView } from '@codemirror/view';

import { trackCommand } from '@/telemetry';

import { Command } from './types';

/**
 * The `cell-editor` commands as a CodeMirror extension. They cannot go through the window dispatcher
 * — CodeMirror binds `Shift-Enter` and `Ctrl-Enter` itself — so `Prec.highest` puts them first.
 *
 * The extension is stable while the ids and chords are, and each binding looks its command up when
 * pressed: `@uiw/react-codemirror` rebuilds the editor whenever its extensions change identity, which
 * would drop the completion popup mid-word.
 */
export function useEditorCommandKeymap(commands: Command[]): Extension {
  const latest = useRef(commands);
  latest.current = commands;

  // All the keymap is built from: the ids and chords, one per line.
  const signature = commands
    .filter((command) => command.scope === 'cell-editor' && command.keys)
    .map((command) => `${command.id}\0${command.keys?.join(' ')}`)
    .join('\n');

  return useMemo(() => {
    const bindings: KeyBinding[] = [];

    for (const line of signature === '' ? [] : signature.split('\n')) {
      const [id, keys] = line.split('\0');
      const run = (view: EditorView) => {
        const current = latest.current.find((candidate) => candidate.id === id);
        if (!current || (current.isEnabled && !current.isEnabled())) {
          // False hands the chord back, so a disabled command leaves CodeMirror's own binding working.
          return false;
        }
        // CodeMirror dismisses a completion list only on Escape or an edit, so one open when the cell
        // runs would sit over the next cell for as long as the run takes.
        closeCompletion(view);
        // This path bypasses the registry's own counting: NotebookEditor hands the raw commands here.
        trackCommand(id);
        current.execute();
        return true;
      };
      for (const key of keys.split(' ')) {
        bindings.push({ key, run });
      }
    }

    return Prec.highest(keymap.of(bindings));
  }, [signature]);
}
