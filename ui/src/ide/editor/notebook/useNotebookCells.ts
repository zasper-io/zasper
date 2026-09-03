import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { getNotebook, ICell, INotebookModel } from '@/api';

import { applyKernelMessage, IKernelMessage } from './kernelMessages';

const emptyNotebook: INotebookModel = {
  cells: [],
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
};

function newCell(): ICell {
  return {
    execution_count: 0,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [copiedCell, setCopiedCell] = useState<ICell | null>(null);
  const [cutCellIndex, setCutCellIndex] = useState<number | null>(null);
  const divRefs = useRef<(HTMLDivElement | null)[]>([]);

  const loadNotebook = useCallback(async (path: string) => {
    try {
      const resJson = await getNotebook(path);

      if (resJson.content.cells === null) {
        resJson.content.cells = [newCell()];
      }
      resJson.content.cells.forEach((cell) => {
        cell.id = uuidv4(); // cell ids double as the kernel request msg_id
        cell.reload = false;
      });
      setNotebook(resJson.content);
      setLoading(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      setLoading(false); // Ensure loading is set to false
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

  const applyMessage = useCallback((message: IKernelMessage) => {
    setNotebook((prevNotebook) => applyKernelMessage(prevNotebook, message));
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
