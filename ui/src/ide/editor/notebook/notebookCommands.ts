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
  const runFocusedCell = () => {
    const cell = focusedCell();
    if (cell) {
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
      isEnabled: () => hasCell() && hasKernel(),
      execute: runFocusedCell,
    },
    {
      id: 'notebook:run-cell-and-advance',
      label: 'Run Cell and Select Next',
      category: 'Notebook',
      scope: 'cell-editor',
      keys: ['Shift-Enter'],
      isEnabled: () => hasCell() && hasKernel(),
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

    notebookCommand({
      id: 'notebook:insert-cell-above',
      label: 'Insert Cell Above',
      keys: ['Ctrl-a'],
      execute: cells.addCellUp,
    }),
    notebookCommand({
      id: 'notebook:insert-cell-below',
      label: 'Insert Cell Below',
      keys: ['Ctrl-b'],
      execute: cells.addCellDown,
    }),
    notebookCommand({
      id: 'notebook:delete-cell',
      label: 'Delete Cell',
      keys: ['Ctrl-Shift-d'],
      isEnabled: hasCell,
      execute: cells.deleteCell,
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
      keys: ['Ctrl-y'],
      isEnabled: hasCell,
      execute: () => cells.changeCellType('code'),
    }),
    notebookCommand({
      id: 'notebook:change-to-markdown',
      label: 'Change Cell to Markdown',
      keys: ['Ctrl-m'],
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
      execute: kernel.toggleKernelSwitcher,
    }),
  ];
}
