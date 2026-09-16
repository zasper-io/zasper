import { defineCommands } from '@/commands/define';
import { Command } from '@/commands/types';

import type { ExportFormatId } from './export/exportFormats';
import { KernelSession } from './useKernelSession';
import { NotebookCells } from './useNotebookCells';

/**
 * The parts of a notebook tab a command can act on. `cells` and `kernel` are the tab's two hooks;
 * the rest are the actions `NotebookEditor` composes out of both of them.
 */
export interface NotebookCommandTargets {
  cells: NotebookCells;
  kernel: KernelSession;
  saveNotebook: () => void;
  /** Opens the notebook's find card, or takes its field back when it is already up (story 17). */
  openFind: () => void;
  submitCell: (source: string, cellId: string) => void;
  submitAllCells: () => void;
  /** Writes the notebook, as it is on screen, to the reader's downloads. See export/. */
  exportNotebook: (format: ExportFormatId) => void;
  restartKernel: () => void;
  restartAndExecuteAllCells: () => void;
}

const NOTEBOOK = { category: 'Notebook', scope: 'notebook' } as const;
const CELL_EDITOR = { category: 'Notebook', scope: 'cell-editor' } as const;
const KERNEL = { category: 'Kernel', scope: 'notebook' } as const;

/**
 * Every action a notebook offers, in one list. Before this the same actions were written out three
 * times over — once in `NbButtons`, once in `CellButtons`, and once as chords across two `keydown`
 * handlers and a CodeMirror keymap — and the copies had drifted.
 *
 * Chords are the ones the notebook already responded to. Nothing new is invented here, and the one
 * binding that is deliberately gone is `Shift-M`: it lived in the cell's editor keymap, which meant
 * a capital M could not be typed into any cell.
 */
export const NOTEBOOK_COMMANDS = defineCommands({
  'notebook:save': {
    ...NOTEBOOK,
    label: 'Save Notebook',
    // Both spellings: the handler this replaces accepted Ctrl and Cmd alike on every platform.
    keys: ['Mod-s', 'Ctrl-s'],
  },

  // Ctrl-Enter and Shift-Enter belong to the editor: CodeMirror binds them itself, so a window
  // listener never sees them.
  'notebook:run-cell': { ...CELL_EDITOR, label: 'Run Cell', keys: ['Ctrl-Enter'] },
  'notebook:run-cell-and-advance': {
    ...CELL_EDITOR,
    label: 'Run Cell and Select Next',
    keys: ['Shift-Enter'],
  },
  'notebook:run-all-cells': { ...NOTEBOOK, label: 'Run All Cells' },

  // Ctrl-Shift-, not bare Ctrl-, and the same shape as delete-cell below. These were `Ctrl-a` and
  // `Ctrl-b`, which a cell's editor never saw: on macOS those are the system Emacs bindings for
  // start-of-line and back-one-character that CodeMirror honours, and Ctrl-A is select-all
  // everywhere else — so pressing it in a cell inserted a cell instead of selecting the text.
  'notebook:insert-cell-above': { ...NOTEBOOK, label: 'Insert Cell Above', keys: ['Ctrl-Shift-a'] },
  'notebook:insert-cell-below': { ...NOTEBOOK, label: 'Insert Cell Below', keys: ['Ctrl-Shift-b'] },
  // Notebook-level undo, distinct from the per-cell text history CodeMirror keeps. `Mod-z` inside
  // a focused editor is CodeMirror's, and it wins there; this is the chord for a structural change
  // — a deleted cell used to be unrecoverable by any means.
  'notebook:undo-cell-change': {
    ...NOTEBOOK,
    label: 'Undo Cell Operation',
    keys: ['Mod-Shift-z'],
  },
  // Reordering, which the notebook had no way to do at all: the chevrons in the cell toolbar move
  // the *selection*, and nothing moved the cell. On the `Ctrl-Shift-` family the other cell
  // operations use; the arrows are free there, since CodeMirror binds `Shift-ArrowUp` and
  // `Alt-ArrowUp` but nothing with Ctrl and Shift together.
  'notebook:move-cell-up': { ...NOTEBOOK, label: 'Move Cell Up', keys: ['Ctrl-Shift-ArrowUp'] },
  'notebook:move-cell-down': {
    ...NOTEBOOK,
    label: 'Move Cell Down',
    keys: ['Ctrl-Shift-ArrowDown'],
  },
  'notebook:delete-cell': { ...NOTEBOOK, label: 'Delete Cell', keys: ['Ctrl-Shift-d'] },
  // The two answers to a cell that printed more than anyone wants to scroll past. `.inner-text`
  // caps the height of an output area; this pair is how you see all of it, or get rid of it.
  'notebook:toggle-output-height': { ...NOTEBOOK, label: 'Expand or Collapse Output' },
  'notebook:clear-cell-outputs': { ...NOTEBOOK, label: 'Clear Cell Output' },
  'notebook:clear-all-outputs': { ...NOTEBOOK, label: 'Clear All Outputs' },
  'notebook:cut-cell': { ...NOTEBOOK, label: 'Cut Cell' },
  'notebook:copy-cell': { ...NOTEBOOK, label: 'Copy Cell' },
  'notebook:paste-cell': { ...NOTEBOOK, label: 'Paste Cell' },

  'notebook:select-next-cell': { ...NOTEBOOK, label: 'Select Next Cell' },
  'notebook:select-previous-cell': { ...NOTEBOOK, label: 'Select Previous Cell' },

  // One command per target type rather than one that cycles: a palette entry has to say what it
  // will do, and the toolbar's <select> picks a type outright. Raw gets no chord, as before.
  'notebook:change-to-code': { ...NOTEBOOK, label: 'Change Cell to Code', keys: ['Ctrl-Shift-y'] },
  'notebook:change-to-markdown': {
    ...NOTEBOOK,
    label: 'Change Cell to Markdown',
    // Ctrl-M is a literal carriage return in a macOS text field, so the bare chord was
    // unreachable inside a cell for the same reason as the insert-cell pair above.
    keys: ['Ctrl-Shift-m'],
  },
  'notebook:change-to-raw': { ...NOTEBOOK, label: 'Change Cell to Raw' },

  // The notebook's, not a cell's: `searchKeymap` is off in the cells, so this reaches the window
  // dispatcher from inside an editor as well as from the pane around it.
  'notebook:find': { ...NOTEBOOK, label: 'Find and Replace', keys: ['Mod-f'] },

  // Three formats, three commands, no chords: an export is something you go looking for, not
  // something you reach for mid-edit, and every chord spent here is one a cell cannot have. The
  // labels say what comes out rather than what happens, because that is the choice being made —
  // `catalog.ts` flattens these, so the palette and the Help tab list them with no further wiring.
  'notebook:export-html': { ...NOTEBOOK, label: 'Export as an HTML Page' },
  'notebook:export-markdown': { ...NOTEBOOK, label: 'Export as Markdown' },
  'notebook:export-script': { ...NOTEBOOK, label: 'Export as a Script' },

  'notebook:interrupt-kernel': { ...KERNEL, label: 'Interrupt Kernel' },
  'notebook:restart-kernel': { ...KERNEL, label: 'Restart Kernel' },
  'notebook:restart-and-run-all': { ...KERNEL, label: 'Restart Kernel and Run All Cells' },
  'notebook:reconnect-kernel': { ...KERNEL, label: 'Reconnect to Kernel' },
  'notebook:change-kernel': { ...KERNEL, label: 'Change Kernel' },
});

/**
 * `NOTEBOOK_COMMANDS`, bound to one notebook tab.
 *
 * Deliberately not memoized. Bodies close over the current cells and kernel, so a dependency list
 * would have to name everything and would go stale the moment it did not; `useRegisterCommands`
 * is built to be handed a fresh array every render and only re-registers when the ids change.
 */
export function useNotebookCommands(targets: NotebookCommandTargets): Command[] {
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

  return [
    {
      ...NOTEBOOK_COMMANDS['notebook:save'],
      // Saving after a failed read would write the empty starting state over the file.
      isEnabled: isLoaded,
      execute: targets.saveNotebook,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:find'],
      isEnabled: isLoaded,
      execute: targets.openFind,
    },
    // Guarded the way save is: after a failed read what is on screen is the error, and exporting it
    // would hand someone a page of the empty starting state.
    {
      ...NOTEBOOK_COMMANDS['notebook:export-html'],
      isEnabled: isLoaded,
      execute: () => targets.exportNotebook('html'),
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:export-markdown'],
      isEnabled: isLoaded,
      execute: () => targets.exportNotebook('markdown'),
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:export-script'],
      isEnabled: isLoaded,
      execute: () => targets.exportNotebook('script'),
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:run-cell'],
      // A markdown cell renders without one, so the kernel is only required for a code cell.
      isEnabled: () => hasCell() && (focusedCell()?.cell_type !== 'code' || hasKernel()),
      execute: runFocusedCell,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:run-cell-and-advance'],
      isEnabled: () => hasCell() && (focusedCell()?.cell_type !== 'code' || hasKernel()),
      execute: () => {
        runFocusedCell();
        // `true`: on the last cell this appends one, which is what Shift-Enter did before and what
        // Jupyter does. (The dead window handler moved without appending — the editor keymap won,
        // so this is the behaviour that was actually observable.)
        cells.focusNextCell(true);
      },
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:run-all-cells'],
      isEnabled: hasKernel,
      execute: targets.submitAllCells,
    },
    { ...NOTEBOOK_COMMANDS['notebook:insert-cell-above'], execute: cells.addCellUp },
    { ...NOTEBOOK_COMMANDS['notebook:insert-cell-below'], execute: cells.addCellDown },
    {
      ...NOTEBOOK_COMMANDS['notebook:undo-cell-change'],
      isEnabled: () => cells.canUndoCellChange,
      execute: cells.undoCellChange,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:move-cell-up'],
      // Disabled at the top rather than silently doing nothing, so the toolbar button greys out.
      isEnabled: () => focusedIndex > 0,
      execute: cells.moveCellUp,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:move-cell-down'],
      isEnabled: () => focusedIndex >= 0 && focusedIndex < notebook.cells.length - 1,
      execute: cells.moveCellDown,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:delete-cell'],
      isEnabled: hasCell,
      execute: cells.deleteCell,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:toggle-output-height'],
      isEnabled: () => (focusedCell()?.outputs?.length ?? 0) > 0,
      execute: cells.toggleOutputExpanded,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:clear-cell-outputs'],
      isEnabled: () => (focusedCell()?.outputs?.length ?? 0) > 0,
      execute: cells.clearFocusedCellOutputs,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:clear-all-outputs'],
      // The document, not the kernel: nothing it holds in memory is touched, so unlike a restart
      // this is not worth a dialog — and `notebook:undo-cell-change` takes it back.
      isEnabled: isLoaded,
      execute: cells.clearAllOutputs,
    },
    { ...NOTEBOOK_COMMANDS['notebook:cut-cell'], isEnabled: hasCell, execute: cells.cutCell },
    { ...NOTEBOOK_COMMANDS['notebook:copy-cell'], isEnabled: hasCell, execute: cells.copyCell },
    {
      ...NOTEBOOK_COMMANDS['notebook:paste-cell'],
      isEnabled: () => cells.copiedCell !== null,
      execute: cells.pasteCell,
    },

    {
      ...NOTEBOOK_COMMANDS['notebook:select-next-cell'],
      isEnabled: hasCell,
      execute: cells.goToNextCell,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:select-previous-cell'],
      isEnabled: hasCell,
      execute: cells.goToPreviousCell,
    },

    {
      ...NOTEBOOK_COMMANDS['notebook:change-to-code'],
      isEnabled: hasCell,
      execute: () => cells.changeCellType('code'),
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:change-to-markdown'],
      isEnabled: hasCell,
      execute: () => cells.changeCellType('markdown'),
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:change-to-raw'],
      isEnabled: hasCell,
      execute: () => cells.changeCellType('raw'),
    },

    {
      ...NOTEBOOK_COMMANDS['notebook:interrupt-kernel'],
      isEnabled: hasKernel,
      execute: kernel.interruptKernel,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:restart-kernel'],
      isEnabled: hasKernel,
      execute: targets.restartKernel,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:restart-and-run-all'],
      isEnabled: hasKernel,
      execute: targets.restartAndExecuteAllCells,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:reconnect-kernel'],
      isEnabled: hasKernel,
      execute: kernel.reconnectKernel,
    },
    {
      ...NOTEBOOK_COMMANDS['notebook:change-kernel'],
      // The one kernel command that needs no session — it is how you get one — but it does need a
      // document to attach a kernel to.
      isEnabled: isLoaded,
      execute: kernel.toggleKernelSwitcher,
    },
  ];
}
