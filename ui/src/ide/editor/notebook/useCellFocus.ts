import { useCallback, useRef, useState } from 'react';

import { NotebookModel } from '@/api';

/**
 * The pane's view of the document: which cell has the focus, which markdown cell is open for editing,
 * and whose output is let past its height cap. None of it is the document's, and none of it reaches
 * the file.
 *
 * Every cell is named by its id. An index names whichever cell is at that place now, and a cell that
 * moves, or one inserted above it, would take the focus to a different cell than the one it was on.
 */
export function useCellFocus(notebook: NotebookModel) {
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  /**
   * The markdown cell whose source is open. A cell is being edited only while this and the focus are
   * both on it, so moving the focus away renders it again without anything having to clear this.
   */
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [expandedOutputs, setExpandedOutputs] = useState<ReadonlySet<string>>(new Set());
  const cellBoxes = useRef(new Map<string, HTMLDivElement>());
  // Read by callbacks that must stay stable, and by a step taken before the render that follows a
  // focus change.
  const notebookRef = useRef(notebook);
  notebookRef.current = notebook;
  const focusedRef = useRef(focusedCellId);

  // Before any cell has been chosen, and after the focused one is deleted, the first cell has it.
  const found = notebook.cells.findIndex((cell) => cell.id === focusedCellId);
  const focusedIndex = found >= 0 ? found : 0;

  /** Selects a cell by id: what a cell's own `onFocus` calls, and every step from one to another. */
  const focusCell = useCallback((cellId: string | null) => {
    focusedRef.current = cellId;
    setFocusedCellId(cellId);
  }, []);

  /** Where a cell's box is, for the notebook to scroll to and focus. */
  const registerCellBox = useCallback((cellId: string, box: HTMLDivElement | null) => {
    if (box === null) {
      cellBoxes.current.delete(cellId);
    } else {
      cellBoxes.current.set(cellId, box);
    }
  }, []);

  /**
   * Brings a cell into view. `nearest` for the callers that step from one cell to the next — moving
   * the notebook no further than it has to is what makes stepping readable — and `start` for a jump
   * from somewhere else, where the cell asked for should end up where the eye already is rather than
   * scraped along the bottom edge. `.single-line`'s `scroll-margin-top` leaves the insert rail its
   * room in that case.
   */
  const scrollTo = useCallback((cellId: string, block: ScrollLogicalPosition = 'nearest') => {
    cellBoxes.current.get(cellId)?.scrollIntoView({ behavior: 'smooth', block });
  }, []);

  /**
   * Jupyter's command mode on a cell: selected, in view, and its own box holding the keyboard rather
   * than its editor.
   *
   * Deferred by a frame because the cell may not be in the DOM yet — `focusNextCell` appends one when it
   * runs the last cell. `preventScroll`, because a focus scrolls the box flush and the scroll has already
   * said where the notebook should be.
   */
  const focusCellBox = useCallback(
    (cellId: string) => {
      focusCell(cellId);
      requestAnimationFrame(() => {
        scrollTo(cellId);
        cellBoxes.current.get(cellId)?.focus({ preventScroll: true });
      });
    },
    [focusCell, scrollTo]
  );

  /** The cell `offset` places from the focused one, held at either end of the notebook. */
  const cellAround = useCallback((offset: number): string | undefined => {
    const { cells } = notebookRef.current;
    const at = Math.max(
      0,
      cells.findIndex((cell) => cell.id === focusedRef.current)
    );
    return cells[Math.min(Math.max(at + offset, 0), cells.length - 1)]?.id;
  }, []);

  const focusPreviousCell = useCallback(() => {
    const previous = cellAround(-1);
    if (previous !== undefined) {
      focusCellBox(previous);
    }
  }, [cellAround, focusCellBox]);

  /** Opens a markdown cell's source: a double-click on it, or Enter with it focused. */
  const beginEditing = useCallback((cellId: string) => setEditingCellId(cellId), []);

  /** Renders it again: Escape, or running the cell. */
  const endEditing = useCallback(() => setEditingCellId(null), []);

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

  return {
    focusedIndex,
    focusedCellId: notebook.cells[focusedIndex]?.id ?? null,
    focusCell,
    registerCellBox,
    cellAround,
    focusCellBox,
    scrollTo,
    editingCellId,
    setEditingCellId,
    beginEditing,
    endEditing,
    expandedOutputs,
    toggleOutputExpanded,
    focusPreviousCell,
  };
}

export type CellFocus = ReturnType<typeof useCellFocus>;
