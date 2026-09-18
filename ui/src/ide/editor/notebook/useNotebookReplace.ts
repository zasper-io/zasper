import { MutableRefObject, useMemo, useRef } from 'react';
import { EditorView } from '@codemirror/view';

import { NotebookModel } from '@/api';
import { LineEdit, OpenDocument, useOpenDocument } from '@/store/openDocuments';
import { editedText, lineEditChanges } from '../lineEdits';

/**
 * A project replace carried out while the notebook is open: through a cell's editor, so its undo takes
 * the edit back, or into the source of a rendered markdown cell, which has none.
 */
export function useNotebookReplace(options: {
  path: string;
  notebook: NotebookModel;
  /** False while the file is loading or could not be read: there is nothing to replace in. */
  ready: boolean;
  cellViews: MutableRefObject<Map<string, EditorView>>;
  updateCellSource: (value: string, cellId: string) => void;
}) {
  const { path, notebook, ready, cellViews, updateCellSource } = options;
  const notebookRef = useRef(notebook);
  notebookRef.current = notebook;

  const openDoc = useMemo<OpenDocument | null>(
    () =>
      !ready
        ? null
        : {
            applyEdits: (edits) => {
              let applied = 0;
              let stale = 0;
              const byCell = new Map<number, LineEdit[]>();
              edits.forEach((edit) => {
                if (edit.cell === undefined) {
                  stale += 1;
                  return;
                }
                byCell.set(edit.cell, [...(byCell.get(edit.cell) ?? []), edit]);
              });
              byCell.forEach((cellEdits, index) => {
                const cell = notebookRef.current.cells[index];
                if (cell === undefined) {
                  stale += cellEdits.length;
                  return;
                }
                const view = cellViews.current.get(cell.id);
                if (view !== undefined) {
                  const outcome = lineEditChanges(view.state.doc, cellEdits);
                  if (outcome.changes.length > 0) {
                    view.dispatch({ changes: outcome.changes });
                  }
                  applied += outcome.changes.length;
                  stale += outcome.stale;
                  return;
                }
                const outcome = editedText(cell.source, cellEdits);
                if (outcome.applied > 0) {
                  updateCellSource(outcome.text, cell.id);
                }
                applied += outcome.applied;
                stale += outcome.stale;
              });
              return { applied, stale };
            },
          },
    [ready, cellViews, updateCellSource]
  );
  useOpenDocument(path, openDoc);
}
