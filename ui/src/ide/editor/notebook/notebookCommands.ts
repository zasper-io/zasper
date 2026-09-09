import { ICommand } from '@/commands/types';
import { KernelSession } from './useKernelSession';
import { NotebookCells } from './useNotebookCells';

/**
 * The parts of a notebook tab a command can act on. `cells` and `kernel` are the tab's two hooks;
 * the rest are the actions `NotebookEditor` composes out of both of them.
 */
export interface INotebookCommandTargets {
  cells: NotebookCells;
  kernel: KernelSession;
  saveNotebook: () => void;
  submitCell: (source: string, cellId: string) => void;
  submitAllCells: () => void;
  restartKernel: () => void;
  restartAndExecuteAllCells: () => void;
}

/**
 * Every action a notebook offers, in one list. Before this the same actions were written out three
 * times over — once in `NbButtons`, once in `CellButtons`, and once as chords across two `keydown`
 * handlers and a CodeMirror keymap — and the copies had drifted.
 *
 * Chords are the ones the notebook already responded to. Nothing new is invented here, and the one
 * binding that is deliberately gone is `Shift-M`: it lived in the cell's editor keymap, which meant
 * a capital M could not be typed into any cell.
 *
 * Deliberately not memoized. Bodies close over the current cells and kernel, so a dependency list
 * would have to name everything and would go stale the moment it did not; `useRegisterCommands`
 * is built to be handed a fresh array every render and only re-registers when the ids change.
 */
export function useNotebookCommands(targets: INotebookCommandTargets): ICommand[] {
  const { cells, kernel } = targets;
  const { notebook, focusedIndex } = cells;

  const focusedCell = () => notebook.cells[focusedIndex];
  const hasCell = () => focusedCell() !== undefined;
  const hasKernel = () => Boolean(kernel.session);
  /** False once a read failed: what is on screen is then the error, not the file. */
  const isLoaded = () => cells.error === '';
  /**
   * Runs the focused cell — which for a markdown cell means rendering it, not sending its prose to
   * the kernel. That is what it did: `submitCell` was called whatever the cell type was, so
   * Shift-Enter on a heading asked Python to evaluate `## Setup`.
   *
   * A raw cell is neither run nor rendered, as in Jupyter.
   */
  const runFocusedCell = () => {
    const cell = focusedCell();
    if (!cell) {
      return;
    }
    if (cell.cell_type === 'markdown') {
      cells.endEditing();
      return;
    }
    if (cell.cell_type === 'code') {
      targets.submitCell(cell.source, cell.id);
    }
  };

  /** Defaults the two fields most of these share, so each entry says only what is its own. */
  const notebookCommand = (
    command: Omit<ICommand, 'category' | 'scope'> & Partial<Pick<ICommand, 'category' | 'scope'>>
  ): ICommand => ({
    category: 'Notebook',
    scope: 'notebook',
    ...command,
  });

  return [
    notebookCommand({
      id: 'notebook:save',
      label: 'Save Notebook',
      // Both spellings: the handler this replaces accepted Ctrl and Cmd alike on every platform.
      keys: ['Mod-s', 'Ctrl-s'],
      // Saving after a failed read would write the empty starting state over the file.
      isEnabled: isLoaded,
      execute: targets.saveNotebook,
    }),

    // Ctrl-Enter and Shift-Enter belong to the editor: CodeMirror binds them itself, so a window
    // listener never sees them.
    {
      id: 'notebook:run-cell',
      label: 'Run Cell',
      category: 'Notebook',
      scope: 'cell-editor',
      keys: ['Ctrl-Enter'],
      // A markdown cell renders without one, so the kernel is only required for a code cell.
      isEnabled: () => hasCell() && (focusedCell()?.cell_type !== 'code' || hasKernel()),
      execute: runFocusedCell,
    },
    {
      id: 'notebook:run-cell-and-advance',
      label: 'Run Cell and Select Next',
      category: 'Notebook',
      scope: 'cell-editor',
      keys: ['Shift-Enter'],
      isEnabled: () => hasCell() && (focusedCell()?.cell_type !== 'code' || hasKernel()),
      execute: () => {
        runFocusedCell();
        // `true`: on the last cell this appends one, which is what Shift-Enter did before and what
        // Jupyter does. (The dead window handler moved without appending — the editor keymap won,
        // so this is the behaviour that was actually observable.)
        cells.focusNextCell(true);
      },
    },
    notebookCommand({
      id: 'notebook:run-all-cells',
      label: 'Run All Cells',
      isEnabled: hasKernel,
      execute: targets.submitAllCells,
    }),

    // Ctrl-Shift-, not bare Ctrl-, and the same shape as delete-cell below. These were `Ctrl-a` and
    // `Ctrl-b`, which a cell's editor never saw: on macOS those are the system Emacs bindings for
    // start-of-line and back-one-character that CodeMirror honours, and Ctrl-A is select-all
    // everywhere else — so pressing it in a cell inserted a cell instead of selecting the text.
    notebookCommand({
      id: 'notebook:insert-cell-above',
      label: 'Insert Cell Above',
      keys: ['Ctrl-Shift-a'],
      execute: cells.addCellUp,
    }),
    notebookCommand({
      id: 'notebook:insert-cell-below',
      label: 'Insert Cell Below',
      keys: ['Ctrl-Shift-b'],
      execute: cells.addCellDown,
    }),
    // Notebook-level undo, distinct from the per-cell text history CodeMirror keeps. `Mod-z` inside
    // a focused editor is CodeMirror's, and it wins there; this is the chord for a structural change
    // — a deleted cell used to be unrecoverable by any means.
    notebookCommand({
      id: 'notebook:undo-cell-change',
      label: 'Undo Cell Operation',
      keys: ['Mod-Shift-z'],
      isEnabled: () => cells.canUndoCellChange,
      execute: cells.undoCellChange,
    }),
    // Reordering, which the notebook had no way to do at all: the chevrons in the cell toolbar move
    // the *selection*, and nothing moved the cell. On the `Ctrl-Shift-` family the other cell
    // operations use; the arrows are free there, since CodeMirror binds `Shift-ArrowUp` and
    // `Alt-ArrowUp` but nothing with Ctrl and Shift together.
    notebookCommand({
      id: 'notebook:move-cell-up',
      label: 'Move Cell Up',
      keys: ['Ctrl-Shift-ArrowUp'],
      // Disabled at the top rather than silently doing nothing, so the toolbar button greys out.
      isEnabled: () => focusedIndex > 0,
      execute: cells.moveCellUp,
    }),
    notebookCommand({
      id: 'notebook:move-cell-down',
      label: 'Move Cell Down',
      keys: ['Ctrl-Shift-ArrowDown'],
      isEnabled: () => focusedIndex >= 0 && focusedIndex < notebook.cells.length - 1,
      execute: cells.moveCellDown,
    }),
    notebookCommand({
      id: 'notebook:delete-cell',
      label: 'Delete Cell',
      keys: ['Ctrl-Shift-d'],
      isEnabled: hasCell,
      execute: cells.deleteCell,
    }),
    // The two answers to a cell that printed more than anyone wants to scroll past. `.inner-text`
    // caps the height of an output area; this pair is how you see all of it, or get rid of it.
    notebookCommand({
      id: 'notebook:toggle-output-height',
      label: 'Expand or Collapse Output',
      isEnabled: () => (focusedCell()?.outputs?.length ?? 0) > 0,
      execute: cells.toggleOutputExpanded,
    }),
    notebookCommand({
      id: 'notebook:clear-cell-outputs',
      label: 'Clear Cell Output',
      isEnabled: () => (focusedCell()?.outputs?.length ?? 0) > 0,
      execute: cells.clearFocusedCellOutputs,
    }),
    notebookCommand({
      id: 'notebook:clear-all-outputs',
      label: 'Clear All Outputs',
      // The document, not the kernel: nothing it holds in memory is touched, so unlike a restart
      // this is not worth a dialog — and `notebook:undo-cell-change` takes it back.
      isEnabled: isLoaded,
      execute: cells.clearAllOutputs,
    }),
    notebookCommand({
      id: 'notebook:cut-cell',
      label: 'Cut Cell',
      isEnabled: hasCell,
      execute: cells.cutCell,
    }),
    notebookCommand({
      id: 'notebook:copy-cell',
      label: 'Copy Cell',
      isEnabled: hasCell,
      execute: cells.copyCell,
    }),
    notebookCommand({
      id: 'notebook:paste-cell',
      label: 'Paste Cell',
      isEnabled: () => cells.copiedCell !== null,
      execute: cells.pasteCell,
    }),

    notebookCommand({
      id: 'notebook:select-next-cell',
      label: 'Select Next Cell',
      isEnabled: hasCell,
      execute: cells.goToNextCell,
    }),
    notebookCommand({
      id: 'notebook:select-previous-cell',
      label: 'Select Previous Cell',
      isEnabled: hasCell,
      execute: cells.goToPreviousCell,
    }),

    // One command per target type rather than one that cycles: a palette entry has to say what it
    // will do, and the toolbar's <select> picks a type outright. Raw gets no chord, as before.
    notebookCommand({
      id: 'notebook:change-to-code',
      label: 'Change Cell to Code',
      keys: ['Ctrl-Shift-y'],
      isEnabled: hasCell,
      execute: () => cells.changeCellType('code'),
    }),
    notebookCommand({
      id: 'notebook:change-to-markdown',
      label: 'Change Cell to Markdown',
      // Ctrl-M is a literal carriage return in a macOS text field, so the bare chord was
      // unreachable inside a cell for the same reason as the two above.
      keys: ['Ctrl-Shift-m'],
      isEnabled: hasCell,
      execute: () => cells.changeCellType('markdown'),
    }),
    notebookCommand({
      id: 'notebook:change-to-raw',
      label: 'Change Cell to Raw',
      isEnabled: hasCell,
      execute: () => cells.changeCellType('raw'),
    }),

    notebookCommand({
      id: 'notebook:interrupt-kernel',
      label: 'Interrupt Kernel',
      category: 'Kernel',
      isEnabled: hasKernel,
      execute: kernel.interruptKernel,
    }),
    notebookCommand({
      id: 'notebook:restart-kernel',
      label: 'Restart Kernel',
      category: 'Kernel',
      isEnabled: hasKernel,
      execute: targets.restartKernel,
    }),
    notebookCommand({
      id: 'notebook:restart-and-run-all',
      label: 'Restart Kernel and Run All Cells',
      category: 'Kernel',
      isEnabled: hasKernel,
      execute: targets.restartAndExecuteAllCells,
    }),
    notebookCommand({
      id: 'notebook:reconnect-kernel',
      label: 'Reconnect to Kernel',
      category: 'Kernel',
      isEnabled: hasKernel,
      execute: kernel.reconnectKernel,
    }),
    notebookCommand({
      id: 'notebook:change-kernel',
      label: 'Change Kernel',
      category: 'Kernel',
      // The one kernel command that needs no session — it is how you get one — but it does need a
      // document to attach a kernel to.
      isEnabled: isLoaded,
      execute: kernel.toggleKernelSwitcher,
    }),
  ];
}
