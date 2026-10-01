import { useCallback, useMemo, useRef, useState } from 'react';
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
 * Whether the two documents differ in anything the user typed. Outputs and execution counts are
 * left out on purpose: a running kernel rewrites them continuously, and a notebook reconciling with
 * disk has to ask about source alone or it would ask on every kernel message.
 */
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

/** Keys in a fixed order, so that two readings of one file cannot differ by insertion order alone. */
function sortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = record[key];
      return sorted;
    }, {});
}

/**
 * The document as a string, in the shape the server writes it. Comparing two of these is how a
 * change on disk is noticed, so this has to agree with `internal/nbformat`'s normalisation: anything
 * this session adds to a cell and the file does not carry would otherwise make every read of an
 * unchanged file look like someone else's edit.
 */
export function stringifyNotebook(notebook: NotebookModel): string {
  // Cell ids arrived in nbformat 4.5, and the server deletes them from an older document rather than
  // write a key that fails validation against the version the file declares. The ids this session
  // made up for such a file are therefore not on disk, and are not a difference.
  const keepsCellIds = notebook.nbformat_minor >= 5;
  const onDisk = {
    ...notebook,
    cells: notebook.cells.map((cell) => {
      // `reload` is this editor's own, and the server neither sends nor stores it.
      const { reload, id, ...rest } = cell;
      return keepsCellIds ? { ...rest, id } : rest;
    }),
  };
  return JSON.stringify(onDisk, sortedKeys, 2) + '\n';
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
  /*
   * What the file on disk says, as `stringifyNotebook` renders it, or null before it has been read.
   * It is recorded here rather than by the editor because this is the only place that sees what the
   * server sent before the cells are given the ids and flags a session needs. Taking it from the
   * document afterwards is how reading an unchanged file came to look like somebody else's edit.
   */
  const diskForm = useRef<string | null>(null);

  /**
   * Takes a document the server sent as the one now open, recording what the file says on the way
   * in. The cells are the server's own objects, so this is also where they gain what the editor
   * needs them to carry.
   */
  const applyNotebook = useCallback((content: NotebookModel) => {
    diskForm.current = stringifyNotebook(content);
    // A new notebook is `"cells": []` on disk, as Jupyter writes it, and would have nothing to type
    // into. The cell comes from here rather than the file, which gains one on the first save.
    if (!content.cells || content.cells.length === 0) {
      content.cells = [newCell()];
    }
    content.cells.forEach((cell) => {
      // The document's own id is kept, so that saving gives the file back the ids it came with. A
      // notebook older than nbformat 4.5 has none, and gets one to key on for this session.
      cell.id = cell.id || uuidv4();
      cell.reload = false;
    });
    setNotebook(content);
    setSavedNotebook(content);
    setLoading(false);
  }, []);

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
    diskForm.current = stringifyNotebook(saved);
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
    applyNotebook,
    diskForm,
  };
}

export type NotebookDocument = ReturnType<typeof useNotebookDocument>;
