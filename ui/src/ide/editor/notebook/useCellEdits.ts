import { useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { NotebookCell, NotebookModel } from '@/api';

import { CellFocus } from './useCellFocus';
import { newCell, NotebookDocument } from './useNotebookDocument';

/** How many structural changes stay undoable. Bounded so a long session cannot grow without end. */
const UNDO_HISTORY_LIMIT = 100;

/**
 * Changes to the document's cells — adding, deleting, moving, cutting, pasting and retyping them — and
 * the undo stack that takes the structural ones back. CodeMirror's history covers the text inside one
 * cell and nothing above it.
 */
export function useCellEdits(
  { notebook, setNotebook }: Pick<NotebookDocument, 'notebook' | 'setNotebook'>,
  {
    focusedIndex,
    setFocusedIndex,
    setEditingCellId,
    scrollTo,
    focusCellBox,
  }: Pick<
    CellFocus,
    'focusedIndex' | 'setFocusedIndex' | 'setEditingCellId' | 'scrollTo' | 'focusCellBox'
  >,
  clearCellOutputs: (cellId: string) => void
) {
  const [copiedCell, setCopiedCell] = useState<NotebookCell | null>(null);
  const [cutCellIndex, setCutCellIndex] = useState<number | null>(null);
  /**
   * Snapshots taken before each structural change, newest last. Whole documents rather than diffs: a
   * snapshot is a shallow copy that shares the output bundles, and the focused index rides along so
   * that undoing a delete puts the caret back where it was.
   */
  const [undoStack, setUndoStack] = useState<{ notebook: NotebookModel; focusedIndex: number }[]>(
    []
  );

  // Called before the change rather than inside the updater: React may run an updater more than once,
  // which would push the same snapshot twice.
  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [...prev, { notebook, focusedIndex }].slice(-UNDO_HISTORY_LIMIT));
  }, [notebook, focusedIndex]);

  /** Restores the document to before the last structural change. A no-op with nothing to undo. */
  const undoCellChange = useCallback(() => {
    setUndoStack((prev) => {
      const previous = prev[prev.length - 1];
      if (!previous) {
        return prev;
      }
      setNotebook(previous.notebook);
      setFocusedIndex(previous.focusedIndex);
      return prev.slice(0, -1);
    });
  }, [setNotebook, setFocusedIndex]);

  /**
   * Moves the focused cell one place towards `direction`, taking the focus with it so the same cell
   * stays selected and the move can be repeated. A no-op at whichever end it is already at.
   */
  const moveCell = useCallback(
    (direction: -1 | 1) => {
      const target = focusedIndex + direction;
      if (focusedIndex < 0 || target < 0 || target >= notebook.cells.length) {
        return;
      }
      pushUndo();
      setNotebook((prevNotebook) => {
        const cells = [...prevNotebook.cells];
        [cells[focusedIndex], cells[target]] = [cells[target], cells[focusedIndex]];
        return { ...prevNotebook, cells };
      });
      setFocusedIndex(target);
    },
    [notebook, focusedIndex, pushUndo, setNotebook, setFocusedIndex]
  );

  const moveCellUp = useCallback(() => moveCell(-1), [moveCell]);
  const moveCellDown = useCallback(() => moveCell(1), [moveCell]);

  const addCellUp = useCallback(() => {
    pushUndo();
    setNotebook((prevNotebook) => ({
      ...prevNotebook,
      cells: [
        ...prevNotebook.cells.slice(0, focusedIndex),
        newCell(),
        ...prevNotebook.cells.slice(focusedIndex),
      ],
    }));
  }, [focusedIndex, pushUndo, setNotebook]);

  const addCellDown = useCallback(() => {
    pushUndo();
    setNotebook((prevNotebook) => {
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
  }, [focusedIndex, pushUndo, setNotebook]);

  /**
   * Inserts a cell at `index`, which is where the pointer is rather than where the focus is: the rail
   * between two cells. The new cell takes the focus, because the only reason to add one is to type in
   * it.
   */
  const addCellAt = useCallback(
    (index: number, cellType: NotebookCell['cell_type'] = 'code') => {
      pushUndo();
      setNotebook((prevNotebook) => {
        const at = Math.max(0, Math.min(index, prevNotebook.cells.length));
        return {
          ...prevNotebook,
          cells: [
            ...prevNotebook.cells.slice(0, at),
            newCell(cellType),
            ...prevNotebook.cells.slice(at),
          ],
        };
      });
      setFocusedIndex(Math.max(0, index));
    },
    [pushUndo, setNotebook, setFocusedIndex]
  );

  const deleteCell = useCallback(() => {
    pushUndo();
    setNotebook((prevNotebook) => {
      if (focusedIndex < 0 || focusedIndex >= prevNotebook.cells.length) {
        return prevNotebook;
      }

      return {
        ...prevNotebook,
        cells: [
          ...prevNotebook.cells.slice(0, focusedIndex),
          ...prevNotebook.cells.slice(focusedIndex + 1),
        ],
      };
    });
  }, [focusedIndex, pushUndo, setNotebook]);

  const copyCell = useCallback(() => {
    setCopiedCell(notebook.cells[focusedIndex]);
  }, [notebook, focusedIndex]);

  /** Copies the focused cell to the clipboard and removes it from the notebook. */
  const cutCell = useCallback(() => {
    pushUndo();
    setCopiedCell(notebook.cells[focusedIndex]);
    setCutCellIndex(focusedIndex);
    setNotebook((prevNotebook) => ({
      ...prevNotebook,
      cells: [
        ...prevNotebook.cells.slice(0, focusedIndex),
        ...prevNotebook.cells.slice(focusedIndex + 1),
      ],
    }));
  }, [notebook, focusedIndex, pushUndo, setNotebook]);

  const pasteCell = useCallback(() => {
    if (!copiedCell) return;

    pushUndo();
    setNotebook((prevNotebook) => {
      const index =
        focusedIndex >= 0 && focusedIndex < prevNotebook.cells.length
          ? focusedIndex + 1
          : prevNotebook.cells.length;

      return {
        ...prevNotebook,
        cells: [
          ...prevNotebook.cells.slice(0, index),
          // The pasted cell needs an id of its own.
          { ...copiedCell, id: uuidv4() },
          ...prevNotebook.cells.slice(index),
        ],
      };
    });

    if (cutCellIndex !== null) {
      setCutCellIndex(null);
    }
  }, [copiedCell, cutCellIndex, focusedIndex, pushUndo, setNotebook]);

  const updateCellSource = useCallback(
    (value: string, cellId: string) => {
      setNotebook((prevNotebook) => ({
        ...prevNotebook,
        cells: prevNotebook.cells.map((cell) =>
          cell.id === cellId ? { ...cell, source: value } : cell
        ),
      }));
    },
    [setNotebook]
  );

  const changeCellType = useCallback(
    (value: string) => {
      pushUndo();
      const target = notebook.cells[focusedIndex];
      // A cell that has just become markdown shows its source rather than rendering on the spot, as
      // Jupyter does: the text was code a moment ago.
      setEditingCellId(value === 'markdown' && target ? target.id : null);
      setNotebook((prevNotebook) => ({
        ...prevNotebook,
        cells: prevNotebook.cells.map((cell, idx) =>
          idx === focusedIndex ? { ...cell, cell_type: value } : cell
        ),
      }));
    },
    [notebook, focusedIndex, pushUndo, setNotebook, setEditingCellId]
  );

  /** Throws away the focused cell's output. Undoable, because it changes the document. */
  const clearFocusedCellOutputs = useCallback(() => {
    const cell = notebook.cells[focusedIndex];
    if (!cell) {
      return;
    }
    pushUndo();
    clearCellOutputs(cell.id);
  }, [notebook, focusedIndex, pushUndo, clearCellOutputs]);

  /** Throws away every output in the notebook, without touching the kernel. */
  const clearAllOutputs = useCallback(() => {
    pushUndo();
    setNotebook((prevNotebook) => ({
      ...prevNotebook,
      cells: prevNotebook.cells.map((cell) =>
        cell.cell_type === 'code' ? { ...cell, outputs: [], execution_count: null } : cell
      ),
    }));
  }, [pushUndo, setNotebook]);

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
        // Command mode on the cell arrived at, as in Jupyter: the box takes the keyboard, so the
        // next Shift-Enter runs *this* cell and a stray keystroke cannot reach the one just run.
        focusCellBox(newIndex);
        return newIndex;
      });
    },
    [notebook, focusedIndex, addCellDown, setFocusedIndex, scrollTo, focusCellBox]
  );

  return {
    addCellUp,
    addCellDown,
    addCellAt,
    deleteCell,
    copyCell,
    /** Exposed so `notebook:paste-cell` can report itself unavailable with nothing to paste. */
    copiedCell,
    cutCell,
    pasteCell,
    updateCellSource,
    changeCellType,
    moveCellUp,
    moveCellDown,
    undoCellChange,
    /** Exposed so `notebook:undo-cell-change` can report itself unavailable with nothing to undo. */
    canUndoCellChange: undoStack.length > 0,
    clearFocusedCellOutputs,
    clearAllOutputs,
    focusNextCell,
  };
}
