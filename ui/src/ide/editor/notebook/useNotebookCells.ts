import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { apiErrorMessage, getNotebook, ICell, INotebookModel } from '@/api';

import { applyKernelMessage, carriesOutput, IKernelMessage } from './kernelMessages';

/** How many structural changes stay undoable. Bounded so a long session cannot grow without end. */
const UNDO_HISTORY_LIMIT = 100;

const emptyNotebook: INotebookModel = {
  cells: [],
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
};

function newCell(cellType: ICell['cell_type'] = 'code'): ICell {
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
  /**
   * The markdown cell whose source is open for editing, if any. Focus and editing used to be the
   * same thing: a markdown cell rendered its editor whenever it was the focused cell, so a single
   * click anywhere on rendered prose replaced it with raw source, and the first cell of every
   * notebook came up unrendered because it is the cell that has focus on open.
   *
   * A cell is being edited only while this *and* the focus are on it, so moving the focus away
   * re-renders without anything having to clear this — which is what keeps it out of the way of the
   * order a click's focus and dblclick handlers run in.
   */
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  /**
   * The cells whose output area has been let past the height cap `.inner-text` puts on it. View
   * state, not the document's: it is about this pane and must never reach the file.
   */
  const [expandedOutputs, setExpandedOutputs] = useState<ReadonlySet<string>>(new Set());
  /**
   * The document as of the latest render, for `focusCell` — which runs from a browser focus event
   * and so cannot be given the notebook through a dependency array.
   */
  const notebookRef = useRef(notebook);
  notebookRef.current = notebook;
  const [cutCellIndex, setCutCellIndex] = useState<number | null>(null);
  const divRefs = useRef<(HTMLDivElement | null)[]>([]);
  /**
   * The cells that have seen a `clear_output(wait=True)` and are still waiting for something to
   * replace what they show. A ref rather than part of the document: it is a message that has been
   * seen, so it is not the notebook's state and must never reach the file.
   */
  const clearWaiting = useRef(new Set<string>());
  /**
   * Snapshots taken before each structural change, newest last, so that adding, deleting, cutting,
   * pasting and retyping a cell can be taken back. CodeMirror's own history covers the text inside
   * one cell and nothing above it, so before this a deleted cell was simply gone.
   *
   * Whole documents rather than a diff: a notebook is a handful of cells holding references to
   * output bundles that are never mutated in place, so a snapshot is a shallow array copy and the
   * outputs are shared, not duplicated. The focused index rides along because undoing a delete that
   * does not put the caret back where it was is disorienting.
   */
  const [undoStack, setUndoStack] = useState<{ notebook: INotebookModel; focusedIndex: number }[]>(
    []
  );

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

  /**
   * Focuses a cell by id, which is what a cell's own `onFocus` calls.
   *
   * By id rather than by index because a focus handler can run against a stale render: reordering
   * or removing a cell moves DOM nodes, and the focus events that follow can carry the props of the
   * render before the change, where the same index names a different cell. An id does not move. No
   * bug is known to have come from this — the reordering one that prompted it turned out to be
   * `handleKeyDownCM` in Cell.tsx answering modified arrows — but resolving against the notebook as
   * it stands now costs nothing and removes the hazard.
   */
  const focusCell = useCallback((cellId: string) => {
    const index = notebookRef.current.cells.findIndex((cell) => cell.id === cellId);
    if (index >= 0) {
      setFocusedIndex(index);
    }
  }, []);

  /** Opens a markdown cell's source: a double-click on it, or Enter with it focused. */
  const beginEditing = useCallback((cellId: string) => setEditingCellId(cellId), []);

  /** Renders it again: Escape, or running the cell. */
  const endEditing = useCallback(() => setEditingCellId(null), []);

  /**
   * Records the document as it stands, to be restored by `undoCellChange`. Called before the change
   * rather than inside the `setNotebook` updater: an updater has to be pure, and React may run one
   * more than once, which would push the same snapshot twice.
   */
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
  }, []);

  /**
   * Moves the focused cell one place towards `direction`, taking the focus with it so that the same
   * cell stays selected and the move can be repeated. A no-op at whichever end it is already at.
   *
   * Reordering is a structural change like any other, so it goes on the undo stack.
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
        // The two entries traded, rather than a splice-out and a splice-in: one step either way is a
        // swap with the neighbour, and doing it that way needs no second index to be adjusted.
        [cells[focusedIndex], cells[target]] = [cells[target], cells[focusedIndex]];
        return { ...prevNotebook, cells };
      });
      setFocusedIndex(target);
    },
    [notebook, focusedIndex, pushUndo]
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
  }, [focusedIndex, pushUndo]);

  const addCellDown = useCallback(() => {
    pushUndo();
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
  }, [focusedIndex, pushUndo]);

  /**
   * Inserts a cell at `index`, which is where the pointer is rather than where the focus is.
   *
   * `addCellUp` and `addCellDown` above are both relative to `focusedIndex`, so putting a cell
   * somewhere with the mouse cost a click to move the focus there first. The rail between two cells
   * has an index of its own and no opinion about what is focused, so it needs this. The new cell
   * takes the focus, because the only reason to add one is to type in it.
   */
  const addCellAt = useCallback(
    (index: number, cellType: ICell['cell_type'] = 'code') => {
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
    [pushUndo]
  );

  const deleteCell = useCallback(() => {
    pushUndo();
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
  }, [focusedIndex, pushUndo]);

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
  }, [notebook, focusedIndex, pushUndo]);

  const pasteCell = useCallback(() => {
    if (!copiedCell) return; // No cell to paste

    pushUndo();
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
  }, [copiedCell, cutCellIndex, focusedIndex, pushUndo]);

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
      pushUndo();
      const target = notebook.cells[focusedIndex];
      // A cell that has just become markdown shows its source rather than rendering on the spot,
      // which is what Jupyter does: the text was code a moment ago and turning it silently into
      // prose hides what you were looking at.
      setEditingCellId(value === 'markdown' && target ? target.id : null);
      setNotebook((prevNotebook) => ({
        ...prevNotebook,
        cells: prevNotebook.cells.map((cell, idx) =>
          idx === focusedIndex ? { ...cell, cell_type: value } : cell
        ),
      }));
    },
    [notebook, focusedIndex, pushUndo]
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

  /** Lets the focused cell's output past the height cap, or puts it back under it. */
  const toggleOutputExpanded = useCallback(() => {
    const cell = notebook.cells[focusedIndex];
    if (!cell) {
      return;
    }
    setExpandedOutputs((prev) => {
      const next = new Set(prev);
      if (!next.delete(cell.id)) {
        next.add(cell.id);
      }
      return next;
    });
  }, [notebook, focusedIndex]);

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
  }, [pushUndo]);

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
    focusCell,
    divRefs,
    loadNotebook,
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
    editingCellId,
    beginEditing,
    endEditing,
    undoCellChange,
    /** Exposed so `notebook:undo-cell-change` can report itself unavailable with nothing to undo. */
    canUndoCellChange: undoStack.length > 0,
    markCellRunning,
    clearCellOutputs,
    clearFocusedCellOutputs,
    clearAllOutputs,
    expandedOutputs,
    toggleOutputExpanded,
    applyMessage,
    focusNextCell,
    focusPreviousCell,
    goToPreviousCell,
    goToNextCell,
  };
}

export type NotebookCells = ReturnType<typeof useNotebookCells>;
