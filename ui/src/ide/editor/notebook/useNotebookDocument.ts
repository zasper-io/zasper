import { useCallback, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { apiErrorMessage, getNotebook, NotebookCell, NotebookModel } from '@/api';

const emptyNotebook: NotebookModel = {
  cells: [],
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
};

export function newCell(cellType: NotebookCell['cell_type'] = 'code'): NotebookCell {
  return {
    // null, not 0: nbformat's way of saying the cell has not run, and what renders as `[ ]`.
    execution_count: null,
    source: '',
    cell_type: cellType,
    id: uuidv4(),
    reload: false,
    outputs: [],
    metadata: {},
  };
}

/**
 * The notebook document, as one immutable value, and the document as it last reached disk. Every
 * change replaces the notebook object and a change that changes nothing returns the same one, so
 * identity against the saved document is what "unsaved" means.
 */
/** Compares notebook cells (types, ids, and source text) to determine if user edits are unsaved. */
export function isSourceDirty(a: NotebookModel, b: NotebookModel): boolean {
  if (a === b) return false;
  if (a.cells.length !== b.cells.length) return true;
  for (let i = 0; i < a.cells.length; i++) {
    const ca = a.cells[i];
    const cb = b.cells[i];
    if (ca.id !== cb.id || ca.cell_type !== cb.cell_type || ca.source !== cb.source) {
      return true;
    }
  }
  return false;
}

export function useNotebookDocument() {
  const [notebook, setNotebook] = useState<NotebookModel>(emptyNotebook);
  const [savedNotebook, setSavedNotebook] = useState<NotebookModel>(emptyNotebook);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  /**
   * Reads the document, resolving to it, or to null when it could not be read; it never rejects, and
   * the reason is left in `error` for the editor to show. The document is handed back because the
   * caller needs it to start the kernel it names, before this state has been committed.
   */
  const loadNotebook = useCallback(async (path: string): Promise<NotebookModel | null> => {
    try {
      const resJson = await getNotebook(path);

      // A new notebook is `"cells": []` on disk, as Jupyter writes it, and would have nothing to type
      // into. The cell comes from here rather than the file, which gains one on the first save.
      if (!resJson.content.cells || resJson.content.cells.length === 0) {
        resJson.content.cells = [newCell()];
      }
      resJson.content.cells.forEach((cell) => {
        // The document's own id is kept, so that saving gives the file back the ids it came with. A
        // notebook older than nbformat 4.5 has none, and gets one to key on for this session.
        cell.id = cell.id || uuidv4();
        cell.reload = false;
      });
      setNotebook(resJson.content);
      setSavedNotebook(resJson.content);
      setLoading(false);
      return resJson.content;
    } catch (err: unknown) {
      // The server's own reason, not the status line: that sentence is what the editor shows.
      setError(apiErrorMessage(err));
      setLoading(false);
      return null;
    }
  }, []);

  /**
   * Records that `saved` is now what the file holds. It takes the document that was written rather
   * than reading the current one, so a change made while the write was in flight stays unsaved.
   */
  const markSaved = useCallback((saved: NotebookModel) => {
    setSavedNotebook(saved);
  }, []);

  const sourceUnsaved = useMemo(
    () => isSourceDirty(notebook, savedNotebook),
    [notebook, savedNotebook]
  );

  return {
    notebook,
    setNotebook,
    unsaved: notebook !== savedNotebook,
    sourceUnsaved,
    markSaved,
    loading,
    error,
    loadNotebook,
  };
}

export type NotebookDocument = ReturnType<typeof useNotebookDocument>;
