import { useCellEdits } from './useCellEdits';
import { useCellFocus } from './useCellFocus';
import { useCellOutputs } from './useCellOutputs';
import { useNotebookDocument } from './useNotebookDocument';

/**
 * Everything a notebook tab does to its document: the document itself, the focus and view state over
 * it, what the kernel writes into its cells, and the edits made to them.
 *
 * No `keydown` listener lives here or below. Every open tab stays mounted, so a window listener fired
 * for every notebook at once; the chords are commands registered only by the active tab — see
 * notebookCommands.ts.
 */
export function useNotebookCells() {
  const doc = useNotebookDocument();
  const focus = useCellFocus(doc.notebook);
  const outputs = useCellOutputs(doc.setNotebook);
  const edits = useCellEdits(doc, focus, outputs.clearCellOutputs);

  return { ...doc, ...focus, ...outputs, ...edits };
}

export type NotebookCells = ReturnType<typeof useNotebookCells>;
