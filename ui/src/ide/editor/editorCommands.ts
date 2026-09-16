import { toggleComment } from '@codemirror/commands';
import { foldAll, unfoldAll } from '@codemirror/language';
import { formatDocument, jumpToDefinition } from '@codemirror/lsp-client';
import { EditorView } from '@codemirror/view';
import { useSetAtom } from 'jotai';

import { defineCommands } from '@/commands/define';
import { Command } from '@/commands/types';
import { findReferences, symbolAt } from '@/lsp/references';
import { dockOpenAtom, dockTabAtom } from '@/store/languageServers';
import { referencesAtom } from '@/store/references';

const editor = { category: 'Editor', scope: 'app' } as const;

/**
 * What the palette can ask of the file in front.
 *
 * The first three carry no chords: CodeMirror binds all three itself — `Mod-/`, `Ctrl-Alt-[` and
 * `Ctrl-Alt-]` — and a window binding for the same chord would run the command a second time, which for a
 * toggle is no change at all. They are here so the actions can be found by name, which is the only way to
 * reach them without knowing the chord.
 */
export const EDITOR_COMMANDS = defineCommands({
  'editor:toggle-comment': { ...editor, label: 'Toggle Comment' },
  'editor:fold-all': { ...editor, label: 'Fold All' },
  'editor:unfold-all': { ...editor, label: 'Unfold All' },
  // F12 and Shift-Alt-F, bound by the language server client in the editor itself.
  'editor:go-to-definition': { ...editor, label: 'Go to Definition' },
  'editor:format-document': { ...editor, label: 'Format Document' },
  // Story 20's three. The chords are VS Code's, which is where anyone reaching for them learnt them.
  'editor:find-references': { ...editor, label: 'Find All References', keys: ['Shift-F12'] },
  'editor:rename-symbol': { ...editor, label: 'Rename Symbol', keys: ['F2'] },
  'editor:quick-fix': { ...editor, label: 'Quick Fix', keys: ['Mod-.'] },
});

/** What the file in front lends its commands: the file itself, and the two that draw over the editor. */
export interface EditorCommandTarget {
  path: string;
  name: string;
  /** Opens the rename field over the name under the cursor. */
  startRename: () => void;
  /** Opens the quick fix menu at the cursor. */
  showQuickFix: () => void;
}

/** Not memoized, like the notebook's: `useRegisterCommands` re-registers only when the ids change. */
export function useEditorCommands(
  view: () => EditorView | null,
  target: EditorCommandTarget
): Command[] {
  const setReferences = useSetAtom(referencesAtom);
  const setDockOpen = useSetAtom(dockOpenAtom);
  const setDockTab = useSetAtom(dockTabAtom);

  // Focused first: these act where the cursor is, and running one from the palette has just taken the
  // focus away from it.
  const on = (command: (view: EditorView) => boolean) => () => {
    const editor = view();
    if (editor !== null) {
      editor.focus();
      command(editor);
    }
  };

  /** Asks the file's server where a name is used, and shows the asking in the panel while it waits. */
  const askReferences = (editor: EditorView) => {
    const symbol = symbolAt(editor);
    if (symbol === '') {
      return;
    }
    setReferences({ symbol, from: target.path, state: 'asking', files: [], total: 0 });
    setDockTab('references');
    setDockOpen(true);
    findReferences(target.path, target.name, editor)
      .then((answer) => {
        if (answer === null) {
          setReferences({
            symbol,
            from: target.path,
            state: 'unanswered',
            files: [],
            total: 0,
            message: 'No language server is running for this file.',
          });
          return;
        }
        setReferences({ symbol, from: target.path, state: 'answered', ...answer });
      })
      .catch((error: unknown) => {
        setReferences({
          symbol,
          from: target.path,
          state: 'unanswered',
          files: [],
          total: 0,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  return [
    { ...EDITOR_COMMANDS['editor:toggle-comment'], execute: on(toggleComment) },
    { ...EDITOR_COMMANDS['editor:fold-all'], execute: on(foldAll) },
    { ...EDITOR_COMMANDS['editor:unfold-all'], execute: on(unfoldAll) },
    { ...EDITOR_COMMANDS['editor:go-to-definition'], execute: on(jumpToDefinition) },
    { ...EDITOR_COMMANDS['editor:format-document'], execute: on(formatDocument) },
    {
      ...EDITOR_COMMANDS['editor:find-references'],
      execute: () => {
        const editor = view();
        if (editor !== null) {
          askReferences(editor);
        }
      },
    },
    { ...EDITOR_COMMANDS['editor:rename-symbol'], execute: target.startRename },
    { ...EDITOR_COMMANDS['editor:quick-fix'], execute: target.showQuickFix },
  ];
}
