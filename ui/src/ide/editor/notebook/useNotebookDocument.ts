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

/**
 * Returns a canonical JSON string of the notebook, stripping out client-only fields like
 * `reload` and sorting object keys to ensure identical objects produce identical strings
 * regardless of key insertion order.
 */
export function stringifyNotebook(notebook: NotebookModel | NotebookCell): string {
  return (
    JSON.stringify(
      notebook,
      (key, value) => {
        if (key === 'reload') return undefined; // client only field
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          return Object.keys(value)
            .sort()
            .reduce((acc: Record<string, unknown>, k: string) => {
              acc[k] = value[k as keyof typeof value];
              return acc;
            }, {});
        }
        return value;
      },
      2
    ) + '\n'
  );
}

/**
 * The notebook document, as one immutable value, and the document as it last reached disk. Every
 * change replaces the notebook object and a change that changes nothing returns the same one, so
 * identity against the saved document is what "unsaved" means.
 */
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
  const applyNotebook = useCallback(
    (content: NotebookModel) => {
      if (!content.cells || content.cells.length === 0) {
        content.cells = [newCell()];
      }
      content.cells.forEach((cell) => {
        cell.id = cell.id || uuidv4();
        cell.reload = false;
      });
      setNotebook(content);
      setSavedNotebook(content);
      setLoading(false);
    },
    [setNotebook, setSavedNotebook]
  );

  /**
   * Reads the document, resolving to it, or to null when it could not be read; it never rejects, and
   * the reason is left in `error` for the editor to show. The document is handed back because the
   * caller needs it to start the kernel it names, before this state has been committed.
   */
  const loadNotebook = useCallback(
    async (path: string): Promise<NotebookModel | null> => {
      try {
        const resJson = await getNotebook(path);
        applyNotebook(resJson.content);
        return resJson.content;
      } catch (err: unknown) {
        // The server's own reason, not the status line: that sentence is what the editor shows.
        setError(apiErrorMessage(err));
        setLoading(false);
        return null;
      }
    },
    [applyNotebook]
  );

  /**
   * Records that `saved` is now what the file holds. It takes the document that was written rather
   * than reading the current one, so a change made while the write was in flight stays unsaved.
   */
  const markSaved = useCallback((saved: NotebookModel) => {
    setSavedNotebook(saved);
  }, []);

  // We deliberately ignore outputs here because external executions generate output continuously;
  // treating outputs as unsaved would incorrectly trigger conflict bands on every kernel message.
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
    applyNotebook,
  };
}

export type NotebookDocument = ReturnType<typeof useNotebookDocument>;
