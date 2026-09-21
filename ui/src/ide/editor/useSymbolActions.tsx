import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { toast } from 'react-toastify';

import { CodeAction, codeActionsAt, runCodeAction } from '@/lsp/codeActions';
import { markGutter, setFixLine } from '@/lsp/markGutter';
import { symbolAt } from '@/lsp/references';
import { canRename, RenameReach, renameReach, renameSymbol } from '@/lsp/rename';
import { EditOutcome } from '@/lsp/workspaceEdits';
import QuickFixMenu from './QuickFixMenu';
import RenameBox from './RenameBox';
import './symbolActions.scss';

/** How long after the cursor stops moving the server is asked whether it has a fix for that line. */
const LAMP_DELAY = 400;

interface Placed {
  left: number;
  top: number;
}

interface RenameState {
  symbol: string;
  at: Placed;
  reach: RenameReach | null;
}

interface FixState {
  actions: CodeAction[];
  at: Placed;
}

/** What one file's editor says about the outcome of an edit that reached more than itself. */
function said(outcome: EditOutcome): string {
  const written = outcome.onDisk.length;
  const edited = outcome.inEditors.length;
  const parts = [
    `${edited + written} ${edited + written === 1 ? 'file' : 'files'} changed`,
    written > 0 ? `${written} written on disk` : null,
    outcome.skipped > 0 ? `${outcome.skipped} changes left out` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * Rename and quick fix for one file editor: the field over the name, the menu at the cursor,
 * and the gutter that carries the lamp beside the line a fix belongs to.
 *
 * Both overlays are placed from the editor's own coordinates, which is why they live with the editor
 * rather than in a portal: a rename asked for at line 400 of a scrolled file belongs beside line 400.
 */
export function useSymbolActions(options: {
  path: string;
  name: string;
  view: () => EditorView | null;
}) {
  const { path, name } = options;
  const view = options.view;
  const [rename, setRename] = useState<RenameState | null>(null);
  const [fixes, setFixes] = useState<FixState | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const lampTimer = useRef<number>();

  /** Where a document position is, in the pixels of the box the overlays are placed in. */
  const place = useCallback((editor: EditorView, position: number): Placed | null => {
    const coords = editor.coordsAtPos(position);
    const box = area.current?.getBoundingClientRect();
    if (coords === null || box === undefined) {
      return null;
    }
    return { left: Math.max(0, coords.left - box.left), top: coords.bottom - box.top + 4 };
  }, []);

  const startRename = useCallback(() => {
    const editor = view();
    if (editor === null) {
      return;
    }
    const symbol = symbolAt(editor);
    const at = place(editor, editor.state.selection.main.head);
    if (symbol === '' || at === null) {
      return;
    }
    setFixes(null);
    void canRename(name, editor).then((can) => {
      if (can === false) {
        toast.warn('There is nothing here a language server can rename.');
        return;
      }
      setRename({ symbol, at, reach: null });
      void renameReach(path, name, editor).then((reach) => {
        setRename((open) => (open === null ? null : { ...open, reach }));
      });
    });
  }, [name, path, place, view]);

  const applyRename = useCallback(
    (newName: string) => {
      const editor = view();
      setRename(null);
      if (editor === null) {
        return;
      }
      renameSymbol(name, editor, newName)
        .then((outcome) => {
          if (outcome.failed.length > 0) {
            toast.error(`Renamed, except: ${outcome.failed[0].reason}`);
            return;
          }
          toast.success(`Renamed to ${newName} — ${said(outcome)}`);
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
    },
    [name, view]
  );

  const showQuickFix = useCallback(() => {
    const editor = view();
    if (editor === null) {
      return;
    }
    const at = place(editor, editor.state.selection.main.head);
    if (at === null) {
      return;
    }
    setRename(null);
    void codeActionsAt(path, name, editor)
      .then((actions) => {
        if (actions.length === 0) {
          toast.info('There is nothing on offer for this line.');
          return;
        }
        setFixes({ actions, at });
      })
      .catch(() => {
        // A server that refuses the question has nothing to offer, which is what an empty menu says.
      });
  }, [name, path, place, view]);

  const runFix = useCallback(
    (action: CodeAction) => {
      setFixes(null);
      runCodeAction(name, action)
        .then((outcome) => {
          if (outcome !== null && outcome.failed.length > 0) {
            toast.error(`${action.title}: ${outcome.failed[0].reason}`);
            return;
          }
          if (outcome !== null && outcome.onDisk.length > 0) {
            toast.success(`${action.title} — ${said(outcome)}`);
          }
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
    },
    [name]
  );

  /**
   * The lamp: after the cursor settles, the server is asked whether it has anything for that line, and the
   * gutter is told. Asked on a pause rather than on every keystroke — it is a request per cursor move.
   */
  const askAboutLine = useCallback(() => {
    window.clearTimeout(lampTimer.current);
    lampTimer.current = window.setTimeout(() => {
      const editor = view();
      if (editor === null) {
        return;
      }
      const line = editor.state.doc.lineAt(editor.state.selection.main.head).number;
      void codeActionsAt(path, name, editor)
        .then((actions) => {
          const current = view();
          if (current === null) {
            return;
          }
          current.dispatch({ effects: setFixLine.of(actions.length === 0 ? null : line) });
        })
        .catch(() => {
          const current = view();
          current?.dispatch({ effects: setFixLine.of(null) });
        });
    }, LAMP_DELAY);
  }, [name, path, view]);

  useEffect(() => () => window.clearTimeout(lampTimer.current), []);

  const extension: Extension = useMemo(
    () =>
      markGutter((line) => {
        const editor = view();
        if (editor === null) {
          return;
        }
        // The menu opens where the lamp's line starts, which is where the cursor is when it is showing.
        const at = editor.state.doc.line(line).from;
        editor.dispatch({ selection: { anchor: at } });
        showQuickFix();
      }),
    [showQuickFix, view]
  );

  const overlays = (
    <>
      {rename !== null && (
        <RenameBox
          symbol={rename.symbol}
          at={rename.at}
          reach={rename.reach}
          onRename={applyRename}
          onClose={() => setRename(null)}
        />
      )}
      {fixes !== null && (
        <QuickFixMenu
          actions={fixes.actions}
          at={fixes.at}
          onRun={runFix}
          onClose={() => setFixes(null)}
        />
      )}
    </>
  );

  return { area, extension, overlays, startRename, showQuickFix, askAboutLine };
}
