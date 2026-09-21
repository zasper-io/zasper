import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';

import { dockOpenAtom, dockTabAtom } from './languageServers';
import {
  closeTerminalAtom,
  currentTerminalAtom,
  RUN_TERMINAL,
  runInTerminalAtom,
  terminalInputAtom,
  terminalsAtom,
} from './terminals';

describe('running a file in a terminal', () => {
  it('opens the Run terminal, queues the line and brings the dock forward', () => {
    const store = createStore();
    store.set(runInTerminalAtom, "python3 '/p/my file.py'");

    expect(Object.keys(store.get(terminalsAtom))).toEqual([RUN_TERMINAL]);
    expect(store.get(terminalInputAtom)).toEqual({ [RUN_TERMINAL]: ["python3 '/p/my file.py'\r"] });
    expect(store.get(currentTerminalAtom)).toBe(RUN_TERMINAL);
    expect(store.get(dockTabAtom)).toBe('terminal');
    expect(store.get(dockOpenAtom)).toBe(true);
  });

  it('reuses the Run terminal and leaves the numbered ones alone', () => {
    const store = createStore();
    store.set(terminalsAtom, { 'Terminal 1': { id: 'Terminal 1', name: 'Terminal 1' } });
    store.set(runInTerminalAtom, 'python3 a.py');
    store.set(runInTerminalAtom, 'python3 b.py');

    expect(Object.keys(store.get(terminalsAtom))).toEqual(['Terminal 1', RUN_TERMINAL]);
    expect(store.get(terminalInputAtom)).toEqual({
      [RUN_TERMINAL]: ['python3 a.py\r', 'python3 b.py\r'],
    });
  });

  it('drops what was waiting when the terminal is closed first', () => {
    const store = createStore();
    store.set(runInTerminalAtom, 'python3 a.py');
    store.set(closeTerminalAtom, RUN_TERMINAL);

    expect(store.get(terminalInputAtom)).toEqual({});
  });
});
