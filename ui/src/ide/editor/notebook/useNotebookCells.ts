import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { apiErrorMessage, getNotebook, ICell, INotebookModel } from '@/api';

import { applyKernelMessage, carriesOutput, IKernelMessage } from './kernelMessages';

const emptyNotebook: INotebookModel = {
  cells: [],
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
};

function newCell(): ICell {
  return {
    // null, not 0: nbformat's way of saying the cell has not run, and what renders as `[ ]`.
    execution_count: null,
    source: '',
    cell_type: 'code',
    id: uuidv4(),
    reload: false,
    outputs: [],
    metadata: {},
  };
}

/**
 * Owns the notebook document: its cells, which one is focused, and the clipboard
 * used by cut/copy/paste. Every mutation goes through `setNotebook` so the whole
 * document stays a single immutable value.
 */
export function useNotebookCells() {
  const [notebook, setNotebook] = useState<INotebookModel>(emptyNotebook);
  /**
   * The document as it last reached disk, or as it was read. Every change replaces the notebook
   * object and an update that changes nothing returns the same one, so identity against this is
   * what "unsaved" means.
   */
  const [savedNotebook, setSavedNotebook] = useState<INotebookModel>(emptyNotebook);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [copiedCell, setCopiedCell] = useState<ICell | null>(null);
  const [cutCellIndex, setCutCellIndex] = useState<number | null>(null);
  const divRefs = useRef<(HTMLDivElement | null)[]>([]);
  /**
   * The cells that have seen a `clear_output(wait=True)` and are still waiting for something to
   * replace what they show. A ref rather than part of the document: it is a message that has been
   * seen, so it is not the notebook's state and must never reach the file.
   */
  const clearWaiting = useRef(new Set<string>());

  /**
   * Reads the document into this hook, resolving to it, or to null when it could not be read; it
   * never rejects, the reason is left in `error` for the editor to show. The document is handed back
   * because the caller needs it to start the kernel it names, before this state has been committed.
   */
  const loadNotebook = useCallback(async (path: string): Promise<INotebookModel | null> => {
    try {
      const resJson = await getNotebook(path);

      // A new notebook is `"cells": []` on disk, as Jupyter writes it, and would have nothing to
      // type into. The cell comes from here rather than the file, which gains one on the first
      // save, as JupyterLab does.
      if (!resJson.content.cells || resJson.content.cells.length === 0) {
        resJson.content.cells = [newCell()];
      }
      resJson.content.cells.forEach((cell) => {
        // The document's own id is kept, so that saving gives the file back the ids it came with.
        // A notebook older than nbformat 4.5 has none, and gets one to key on for this session.
        cell.id = cell.id || uuidv4();
        cell.reload = false;
      });
      setNotebook(resJson.content);
      setSavedNotebook(resJson.content);
      setLoading(false);
      return resJson.content;
    } catch (err: unknown) {
      // The server's own reason, not the status line: that sentence is what the editor shows in
      // place of the cells.
      setError(apiErrorMessage(err));
      setLoading(false); // Ensure loading is set to false
      return null;
    }
  }, []);

  const addCellUp = useCallback(() => {
    setNotebook((prevNotebook) => ({
      ...prevNotebook,
      cells: [
        ...prevNotebook.cells.slice(0, focusedIndex),
        newCell(),
        ...prevNotebook.cells.slice(focusedIndex),
      ],
    }));
  }, [focusedIndex]);

  const addCellDown = useCallback(() => {
    setNotebook((prevNotebook) => {
      // Ensure the focusedIndex is within the bounds of the cells array
      const index =
        focusedIndex >= 0 && focusedIndex < prevNotebook.cells.length
          ? focusedIndex + 1
          : prevNotebook.cells.length;

      return {
        ...prevNotebook,
        cells: [
          ...prevNotebook.cells.slice(0, index),
          newCell(),
          ...prevNotebook.cells.slice(index),
        ],
      };
    });
  }, [focusedIndex]);

  const deleteCell = useCallback(() => {
    setNotebook((prevNotebook) => {
      // Check if focusedIndex is valid to avoid errors (e.g., empty notebook or invalid index)
      if (focusedIndex < 0 || focusedIndex >= prevNotebook.cells.length) {
        return prevNotebook; // No change if the index is invalid
      }

      return {
        ...prevNotebook,
        cells: [
          ...prevNotebook.cells.slice(0, focusedIndex),
          ...prevNotebook.cells.slice(focusedIndex + 1),
        ],
      };
    });
  }, [focusedIndex]);

  const copyCell = useCallback(() => {
    setCopiedCell(notebook.cells[focusedIndex]);
  }, [notebook, focusedIndex]);

  /** Copies the focused cell to the clipboard and removes it from the notebook. */
  const cutCell = useCallback(() => {
    setCopiedCell(notebook.cells[focusedIndex]);
    setCutCellIndex(focusedIndex);
    setNotebook((prevNotebook) => ({
      ...prevNotebook,
      cells: [
        ...prevNotebook.cells.slice(0, focusedIndex),
        ...prevNotebook.cells.slice(focusedIndex + 1),
      ],
    }));
  }, [notebook, focusedIndex]);

  const pasteCell = useCallback(() => {
    if (!copiedCell) return; // No cell to paste

    setNotebook((prevNotebook) => {
      // Determine the paste index (after focusedIndex or at the end of the notebook)
      const index =
        focusedIndex >= 0 && focusedIndex < prevNotebook.cells.length
          ? focusedIndex + 1
          : prevNotebook.cells.length;

      return {
        ...prevNotebook,
        cells: [
          ...prevNotebook.cells.slice(0, index),
          { ...copiedCell, id: uuidv4() }, // the pasted cell needs its own id
          ...prevNotebook.cells.slice(index),
        ],
      };
    });

    // If it's a cut, reset cut state after pasting
    if (cutCellIndex !== null) {
      setCutCellIndex(null);
    }
  }, [copiedCell, cutCellIndex, focusedIndex]);

  const updateCellSource = useCallback((value: string, cellId: string) => {
    setNotebook((prevNotebook) => ({
      ...prevNotebook,
      cells: prevNotebook.cells.map((cell) =>
        cell.id === cellId ? { ...cell, source: value } : cell
      ),
    }));
  }, []);

  const changeCellType = useCallback(
    (value: string) => {
      setNotebook((prevNotebook) => ({
        ...prevNotebook,
        cells: prevNotebook.cells.map((cell, idx) =>
          idx === focusedIndex ? { ...cell, cell_type: value } : cell
        ),
      }));
    },
    [focusedIndex]
  );

  /** Clears previous output and shows the running spinner (execution_count -1). */
  const markCellRunning = useCallback((cellId: string) => {
    // A fresh run, so a clear left waiting by the last one is not waiting for anything any more.
    clearWaiting.current.delete(cellId);
    setNotebook((prevNotebook) => ({
      ...prevNotebook,
      cells: prevNotebook.cells.map((cell) =>
        cell.id === cellId ? { ...cell, execution_count: -1, outputs: [] } : cell
      ),
    }));
  }, []);

  const clearCellOutputs = useCallback((cellId: string) => {
    setNotebook((prevNotebook) => ({
      ...prevNotebook,
      cells: prevNotebook.cells.map((cell) =>
        cell.id === cellId ? { ...cell, outputs: [] } : cell
      ),
    }));
  }, []);

  const applyMessage = useCallback(
    (message: IKernelMessage, cellId: string | undefined) => {
      if (cellId && message.header.msg_type === 'clear_output') {
        if (message.content?.wait) {
          // Held until there is something to replace what is on screen, which is the whole point of
          // the flag: a progress line rewritten in a loop must not blink empty between the frames.
          clearWaiting.current.add(cellId);
        } else {
          clearWaiting.current.delete(cellId);
          clearCellOutputs(cellId);
        }
        return;
      }

      // Read outside the updater, and only for a message that will actually produce an output: an
      // updater has to be pure, and React may call one more than once for a single message.
      const replaceOutputs =
        cellId !== undefined && carriesOutput(message) && clearWaiting.current.delete(cellId);

      setNotebook((prevNotebook) =>
        applyKernelMessage(prevNotebook, message, cellId, replaceOutputs)
      );
    },
    [clearCellOutputs]
  );

  /**
   * Records that `saved` is now what the file holds. It takes the document that was written rather
   * than reading the current one, so a change made while the write was in flight stays unsaved.
   */
  const markSaved = useCallback((saved: INotebookModel) => {
    setSavedNotebook(saved);
  }, []);

  const scrollTo = (index: number) => {
    divRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  /** Moves focus down, optionally appending a cell when already on the last one. */
  const focusNextCell = useCallback(
    (addCellIfLast: boolean) => {
      let cellCount = notebook.cells.length;
      if (cellCount === focusedIndex + 1 && addCellIfLast) {
        addCellDown();
        cellCount += 1;
      }
      setFocusedIndex((prev) => {
        const newIndex = Math.min(prev + 1, cellCount - 1);
        scrollTo(newIndex);
        return newIndex;
      });
    },
    [notebook, focusedIndex, addCellDown]
  );

  const focusPreviousCell = useCallback(() => {
    setFocusedIndex((prev) => {
      const newIndex = Math.max(prev - 1, 0);
      scrollTo(newIndex);
      return newIndex;
    });
  }, []);

  const goToPreviousCell = useCallback(() => {
    setFocusedIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const goToNextCell = useCallback(() => {
    setFocusedIndex((prev) => Math.min(prev + 1, notebook.cells.length - 1));
  }, [notebook]);

  // No `keydown` listener here any more. This hook runs once per open notebook and every open tab
  // stays mounted (see ContentPanel), so a window listener installed here fired for every notebook
  // at once: Ctrl-B added a cell to all of them. The chords are commands now, registered only by
  // the active tab — see notebookCommands.ts.

  return {
    notebook,
    setNotebook,
    unsaved: notebook !== savedNotebook,
    markSaved,
    loading,
    error,
    focusedIndex,
    setFocusedIndex,
    divRefs,
    loadNotebook,
    addCellUp,
    addCellDown,
    deleteCell,
    copyCell,
    /** Exposed so `notebook:paste-cell` can report itself unavailable with nothing to paste. */
    copiedCell,
    cutCell,
    pasteCell,
    updateCellSource,
    changeCellType,
    markCellRunning,
    clearCellOutputs,
    applyMessage,
    focusNextCell,
    focusPreviousCell,
    goToPreviousCell,
    goToNextCell,
  };
}

export type NotebookCells = ReturnType<typeof useNotebookCells>;
