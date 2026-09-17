import { useCallback, useRef, useState } from 'react';

import { NotebookModel } from '@/api';

/**
 * The pane's view of the document: which cell has the focus, which markdown cell is open for editing,
 * and whose output is let past its height cap. None of it is the document's, and none of it reaches
 * the file.
 */
export function useCellFocus(notebook: NotebookModel) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  /**
   * The markdown cell whose source is open. A cell is being edited only while this and the focus are
   * both on it, so moving the focus away renders it again without anything having to clear this.
   */
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [expandedOutputs, setExpandedOutputs] = useState<ReadonlySet<string>>(new Set());
  const divRefs = useRef<(HTMLDivElement | null)[]>([]);
  // For `focusCell`, which runs from a browser focus event and so cannot take the notebook as a
  // dependency.
  const notebookRef = useRef(notebook);
  notebookRef.current = notebook;

  /**
   * Focuses a cell by id, which is what a cell's own `onFocus` calls. By id because a focus event
   * after a reorder can carry the props of the render before it, where the same index names another
   * cell.
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

  /**
   * Brings a cell into view. `nearest` for the callers that step from one cell to the next — moving
   * the notebook no further than it has to is what makes stepping readable — and `start` for a jump
   * from somewhere else, where the cell asked for should end up where the eye already is rather than
   * scraped along the bottom edge. `.single-line`'s `scroll-margin-top` leaves the insert rail its
   * room in that case.
   */
  const scrollTo = useCallback((index: number, block: ScrollLogicalPosition = 'nearest') => {
    divRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block });
  }, []);

  const focusPreviousCell = useCallback(() => {
    setFocusedIndex((prev) => {
      const newIndex = Math.max(prev - 1, 0);
      scrollTo(newIndex);
      return newIndex;
    });
  }, [scrollTo]);

  const goToPreviousCell = useCallback(() => {
    setFocusedIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const goToNextCell = useCallback(() => {
    setFocusedIndex((prev) => Math.min(prev + 1, notebook.cells.length - 1));
  }, [notebook]);

  return {
    focusedIndex,
    setFocusedIndex,
    focusCell,
    divRefs,
    scrollTo,
    editingCellId,
    setEditingCellId,
    beginEditing,
    endEditing,
    expandedOutputs,
    toggleOutputExpanded,
    focusPreviousCell,
    goToPreviousCell,
    goToNextCell,
  };
}

export type CellFocus = ReturnType<typeof useCellFocus>;
