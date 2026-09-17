import { createContext, RefObject, useContext } from 'react';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { NotebookCell } from '@/api';
import type { WidgetBridge } from '@/ide/widgets/widgetBridge';

import { CompleteReply, KernelMessage } from './kernelMessages';

/**
 * What every cell of one notebook shares: the notebook's actions, its focus, and its kernel's prompt,
 * completions and widgets. What differs from cell to cell is passed to the cell as props.
 */
export interface NotebookEditorContextValue {
  /** Dispatches a notebook command by id, for a cell's own toolbar. */
  run: (id: string) => void;
  /**
   * The notebook's `cell-editor` commands as a CodeMirror extension — Ctrl-Enter, Shift-Enter. Handed
   * to the cells rather than read from the command registry, so a cell can only run its own notebook's
   * commands.
   */
  commandKeymap: Extension;
  /** Highlighting for code cells, in the kernel's language: see useCellLanguage. */
  cellLanguage: Extension;
  /**
   * The search state a cell is searched through, and the marks over it: `search()` and the file
   * editor's own highlighter, one copy per cell. The notebook holds the query and tells every cell
   * what to look for — a notebook is fifty documents, and the library's search is one view's.
   */
  findExtension: Extension;
  /**
   * A cell handing the notebook its editor, or null as it goes.
   *
   * The notebook needs the views to mark matches, to step into one and to replace through the cell's
   * own history. Keyed by cell id, not by index: a cell that moves is the same cell.
   */
  registerCellView: (cellId: string, view: EditorView | null) => void;
  focusedIndex: number;
  /** By id, not by index: see `focusCell` in useCellFocus. */
  focusCell: (cellId: string) => void;
  /** Puts the keyboard on the cell's own box — Jupyter's command mode. By index, as the DOM refs are. */
  focusCellBox: (index: number) => void;
  focusNextCell: (addCellIfLast: boolean) => void;
  focusPreviousCell: () => void;
  divRefs: RefObject<(HTMLDivElement | null)[]>;
  updateCellSource: (value: string, cellId: string) => void;
  /** Puts a cell where the pointer is, for the rail between two cells. */
  addCellAt: (index: number, cellType: NotebookCell['cell_type']) => void;
  /**
   * Runs one named cell, for the button in its gutter. Not `notebook:run-cell`, which acts on the
   * focused index, and a click's focus change has not been rendered yet when the command runs.
   */
  submitCell: (source: string, cellId: string) => void;
  /** The kernel-wide interrupt: the protocol has no per-cell one. */
  interruptKernel: () => void;
  beginEditing: (cellId: string) => void;
  endEditing: () => void;
  showPrompt: boolean;
  promptContent: KernelMessage | undefined;
  /** Which cell the kernel is asking input for, so only that cell shows the prompt. */
  promptCellId: string | undefined;
  submitPrompt: (parentHeader: KernelMessage, inputValue: string) => void;
  toggleShowPrompt: () => void;
  requestCompletions: (source: string, cursorPos: number) => Promise<CompleteReply | null>;
  widgets: WidgetBridge | null;
}

export const NotebookEditorContext = createContext<NotebookEditorContextValue | null>(null);

/** The notebook a cell is part of. Only a component inside a NotebookEditor has one. */
export function useNotebookEditor(): NotebookEditorContextValue {
  const editor = useContext(NotebookEditorContext);
  if (!editor) {
    throw new Error('useNotebookEditor is for components rendered inside a NotebookEditor');
  }
  return editor;
}
