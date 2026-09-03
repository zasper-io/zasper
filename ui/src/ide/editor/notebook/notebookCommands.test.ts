import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ICell } from '@/api';
import { parseChord } from '@/commands/keys';
import { ICommand } from '@/commands/types';

import { INotebookCommandTargets, useNotebookCommands } from './notebookCommands';
import { KernelSession } from './useKernelSession';
import { NotebookCells } from './useNotebookCells';

function cell(overrides: Partial<ICell> = {}): ICell {
  return {
    cell_type: 'code',
    id: 'cell-1',
    execution_count: 0,
    source: 'print("hi")',
    outputs: [],
    metadata: {},
    reload: false,
    ...overrides,
  };
}

interface IFakeOptions {
  cells?: ICell[];
  focusedIndex?: number;
  copiedCell?: ICell | null;
  session?: unknown;
  /** What useNotebookCells reports when the notebook could not be loaded. */
  error?: string;
}

/**
 * The targets a notebook command acts on. Only the fields the commands touch are real — the two
 * hooks behind them are large and none of the rest is reachable from here.
 */
function fakeTargets(options: IFakeOptions = {}) {
  const spies = {
    addCellUp: vi.fn(),
    addCellDown: vi.fn(),
    deleteCell: vi.fn(),
    copyCell: vi.fn(),
    cutCell: vi.fn(),
    pasteCell: vi.fn(),
    changeCellType: vi.fn(),
    focusNextCell: vi.fn(),
    goToNextCell: vi.fn(),
    goToPreviousCell: vi.fn(),
    interruptKernel: vi.fn(),
    reconnectKernel: vi.fn(),
    toggleKernelSwitcher: vi.fn(),
    saveNotebook: vi.fn(),
    submitCell: vi.fn(),
    submitAllCells: vi.fn(),
    restartKernel: vi.fn(),
    restartAndExecuteAllCells: vi.fn(),
  };

  const targets: INotebookCommandTargets = {
    cells: {
      notebook: { cells: options.cells ?? [cell()], nbformat: 4, nbformat_minor: 5, metadata: {} },
      focusedIndex: options.focusedIndex ?? 0,
      copiedCell: options.copiedCell ?? null,
      error: options.error ?? '',
      addCellUp: spies.addCellUp,
      addCellDown: spies.addCellDown,
      deleteCell: spies.deleteCell,
      copyCell: spies.copyCell,
      cutCell: spies.cutCell,
      pasteCell: spies.pasteCell,
      changeCellType: spies.changeCellType,
      focusNextCell: spies.focusNextCell,
      goToNextCell: spies.goToNextCell,
      goToPreviousCell: spies.goToPreviousCell,
    } as unknown as NotebookCells,
    kernel: {
      session: 'session' in options ? options.session : { id: 'session-1' },
      interruptKernel: spies.interruptKernel,
      reconnectKernel: spies.reconnectKernel,
      toggleKernelSwitcher: spies.toggleKernelSwitcher,
    } as unknown as KernelSession,
    saveNotebook: spies.saveNotebook,
    submitCell: spies.submitCell,
    submitAllCells: spies.submitAllCells,
    restartKernel: spies.restartKernel,
    restartAndExecuteAllCells: spies.restartAndExecuteAllCells,
  };

  return { targets, spies };
}

function build(options: IFakeOptions = {}) {
  const { targets, spies } = fakeTargets(options);
  const { result } = renderHook(() => useNotebookCommands(targets));
  return { commands: result.current, spies };
}

function byId(commands: ICommand[], id: string): ICommand {
  const command = commands.find((candidate) => candidate.id === id);
  if (!command) {
    throw new Error(`no such command: ${id}`);
  }
  return command;
}

/** A chord reduced to the modifiers that actually fire plus the key, for comparing two spellings. */
function resolved(binding: string, mac: boolean): string {
  const chord = parseChord(binding, mac);
  return [
    chord.meta ? 'Meta' : '',
    chord.ctrl ? 'Ctrl' : '',
    chord.alt ? 'Alt' : '',
    chord.shift ? 'Shift' : '',
    chord.key,
  ]
    .filter(Boolean)
    .join('-');
}

describe('useNotebookCommands', () => {
  it('gives every command an id, a label and a category', () => {
    const { commands } = build();

    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command.id, JSON.stringify(command)).toMatch(/^notebook:[a-z-]+$/);
      expect(command.label, command.id).toBeTruthy();
      expect(command.category, command.id).toBeTruthy();
      expect(typeof command.execute, command.id).toBe('function');
    }
  });

  it('has no duplicate ids', () => {
    const ids = build().commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The bug this replaces: two surfaces bound the same chord to different actions and neither knew
  // about the other. Both platforms are checked because Mod- resolves differently on each, so a
  // collision can exist on one and not the other.
  it.each([
    ['mac', true],
    ['other platforms', false],
  ])('binds each chord to at most one command on %s', (_platform, mac) => {
    const owners = new Map<string, Set<string>>();

    for (const command of build().commands) {
      for (const binding of command.keys ?? []) {
        const chord = `${command.scope} ${resolved(binding, mac)}`;
        const ids = owners.get(chord) ?? new Set<string>();
        ids.add(command.id);
        owners.set(chord, ids);
      }
    }

    for (const [chord, ids] of owners) {
      expect(Array.from(ids), chord).toHaveLength(1);
    }
  });

  // The capital-M bug, as an invariant: Shift plus a letter is a character someone is trying to
  // type, so it can never be a binding. `Shift-M` used to change the cell type instead.
  it('never binds a chord that is just a shifted character', () => {
    for (const command of build().commands) {
      for (const binding of command.keys ?? []) {
        const chord = parseChord(binding);
        const typable = chord.key.length === 1 && !chord.meta && !chord.ctrl && !chord.alt;
        expect(typable, `${command.id} binds ${binding}`).toBe(false);
      }
    }
  });

  it('runs the focused cell', () => {
    const cells = [cell({ id: 'a', source: 'first' }), cell({ id: 'b', source: 'second' })];
    const { commands, spies } = build({ cells, focusedIndex: 1 });

    byId(commands, 'notebook:run-cell').execute();

    expect(spies.submitCell).toHaveBeenCalledWith('second', 'b');
  });

  it('advances after running, appending a cell when on the last one', () => {
    const { commands, spies } = build();

    byId(commands, 'notebook:run-cell-and-advance').execute();

    expect(spies.submitCell).toHaveBeenCalledWith('print("hi")', 'cell-1');
    expect(spies.focusNextCell).toHaveBeenCalledWith(true);
  });

  it('disables the cell and kernel commands when there is no kernel', () => {
    const { commands } = build({ session: undefined });

    expect(byId(commands, 'notebook:run-cell').isEnabled?.()).toBe(false);
    expect(byId(commands, 'notebook:run-all-cells').isEnabled?.()).toBe(false);
    expect(byId(commands, 'notebook:restart-kernel').isEnabled?.()).toBe(false);
    // Saving, attaching one and inserting cells do not need one.
    expect(byId(commands, 'notebook:save').isEnabled?.()).toBe(true);
    expect(byId(commands, 'notebook:change-kernel').isEnabled?.()).toBe(true);
    expect(byId(commands, 'notebook:insert-cell-below').isEnabled?.()).toBeUndefined();
  });

  it('refuses to save or attach a kernel to a notebook that could not be loaded', () => {
    const { commands } = build({ error: 'not a valid notebook: unexpected end of JSON input' });

    expect(byId(commands, 'notebook:save').isEnabled?.()).toBe(false);
    expect(byId(commands, 'notebook:change-kernel').isEnabled?.()).toBe(false);
  });

  it('disables the cell commands when the notebook is empty', () => {
    const { commands } = build({ cells: [] });

    expect(byId(commands, 'notebook:delete-cell').isEnabled?.()).toBe(false);
    expect(byId(commands, 'notebook:change-to-markdown').isEnabled?.()).toBe(false);
    expect(byId(commands, 'notebook:run-cell').isEnabled?.()).toBe(false);
  });

  it('enables paste only once a cell has been copied', () => {
    expect(byId(build().commands, 'notebook:paste-cell').isEnabled?.()).toBe(false);
    expect(byId(build({ copiedCell: cell() }).commands, 'notebook:paste-cell').isEnabled?.()).toBe(
      true
    );
  });

  it('changes the cell type through one command per target type', () => {
    const { commands, spies } = build();

    byId(commands, 'notebook:change-to-code').execute();
    byId(commands, 'notebook:change-to-markdown').execute();
    byId(commands, 'notebook:change-to-raw').execute();

    expect(spies.changeCellType.mock.calls).toEqual([['code'], ['markdown'], ['raw']]);
  });

  it('keeps Ctrl-Enter and Shift-Enter in the editor, where CodeMirror would swallow them', () => {
    const commands = build().commands;

    expect(byId(commands, 'notebook:run-cell').scope).toBe('cell-editor');
    expect(byId(commands, 'notebook:run-cell-and-advance').scope).toBe('cell-editor');
    // Everything else is dispatched from the window, and only while the tab is active.
    for (const command of commands) {
      if (!command.id.startsWith('notebook:run-cell')) {
        expect(command.scope, command.id).toBe('notebook');
      }
    }
  });
});
