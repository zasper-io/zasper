import { toggleComment } from '@codemirror/commands';
import { foldAll, unfoldAll } from '@codemirror/language';
import { formatDocument, jumpToDefinition } from '@codemirror/lsp-client';
import { EditorView } from '@codemirror/view';

import { defineCommands } from '@/commands/define';
import { Command } from '@/commands/types';

const editor = { category: 'Editor', scope: 'app' } as const;

/**
 * What the palette can ask of the file in front.
 *
 * No chords: CodeMirror binds all three itself — `Mod-/`, `Ctrl-Alt-[` and `Ctrl-Alt-]` — and a window
 * binding for the same chord would run the command a second time, which for a toggle is no change at all.
 * These are here so the actions can be found by name, which is the only way to reach them without
 * knowing the chord.
 */
export const EDITOR_COMMANDS = defineCommands({
  'editor:toggle-comment': { ...editor, label: 'Toggle Comment' },
  'editor:fold-all': { ...editor, label: 'Fold All' },
  'editor:unfold-all': { ...editor, label: 'Unfold All' },
  // F12 and Shift-Alt-F, bound by the language server client in the editor itself.
  'editor:go-to-definition': { ...editor, label: 'Go to Definition' },
  'editor:format-document': { ...editor, label: 'Format Document' },
});

/** Not memoized, like the notebook's: `useRegisterCommands` re-registers only when the ids change. */
export function useEditorCommands(view: () => EditorView | null): Command[] {
  // Focused first: these act where the cursor is, and running one from the palette has just taken the
  // focus away from it.
  const on = (command: (view: EditorView) => boolean) => () => {
    const editor = view();
    if (editor !== null) {
      editor.focus();
      command(editor);
    }
  };

  return [
    { ...EDITOR_COMMANDS['editor:toggle-comment'], execute: on(toggleComment) },
    { ...EDITOR_COMMANDS['editor:fold-all'], execute: on(foldAll) },
    { ...EDITOR_COMMANDS['editor:unfold-all'], execute: on(unfoldAll) },
    { ...EDITOR_COMMANDS['editor:go-to-definition'], execute: on(jumpToDefinition) },
    { ...EDITOR_COMMANDS['editor:format-document'], execute: on(formatDocument) },
  ];
}
