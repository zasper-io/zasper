import { atom } from 'jotai';

import { dockOpenAtom, dockTabAtom } from './languageServers';

export interface TerminalRef {
  name: string;
  id: string;
  /** Where the shell was started from, when it was not the project root. */
  cwd?: string;
}

export interface TerminalRefs {
  [key: string]: TerminalRef;
}

/** The terminals this window has open, by name. */
export const terminalsAtom = atom<TerminalRefs>({});

/**
 * The one the dock is showing, by name, or '' when there is none.
 *
 * A terminal was once a tab, so the tab strip answered this; in the panel under the editor the
 * list beside the pane does, and every open shell stays mounted behind it — a socket that is torn down
 * and remade is a new shell wearing an old name.
 */
export const currentTerminalAtom = atom<string>('');
export const terminalsCountAtom = atom<number>(0);

/**
 * Closes one shell: it leaves this window's list, its pane unmounts, and the socket goes with it —
 * which is what ends the shell. A terminal's life *is* its websocket here, so there is no separate
 * shutdown to ask the server for: `cleanupTTY` kills the TTY and unregisters the session as soon as
 * the connection drops, and the row is gone from `/api/terminals` on the next read.
 *
 * A write-only atom rather than an action on `useTabActions`, so that reading the list to decide what
 * comes forward next does not subscribe every consumer of that hook to it.
 */
export const closeTerminalAtom = atom(null, (get, set, name: string) => {
  const terminals = get(terminalsAtom);
  if (terminals[name] === undefined) {
    return;
  }

  const names = Object.keys(terminals);
  const next = { ...terminals };
  delete next[name];
  set(terminalsAtom, next);
  const pending = { ...get(terminalInputAtom) };
  delete pending[name];
  set(terminalInputAtom, pending);

  // The one before it, as closing a tab comes back to its neighbour rather than to the top of the
  // strip; the one after it when the first was closed, and nothing when that was the last shell.
  if (get(currentTerminalAtom) === name) {
    const closed = names.indexOf(name);
    set(currentTerminalAtom, names[closed - 1] ?? names[closed + 1] ?? '');
  }
});

/** Lines waiting to be typed into a shell, by name. Its pane takes them once its socket is open. */
export const terminalInputAtom = atom<Record<string, string[]>>({});

/** The shell files are run in, kept apart from the numbered ones so a run never types into those. */
export const RUN_TERMINAL = 'Run';

/**
 * Types a line into the Run terminal and brings it forward, opening it first when it is not. Into a
 * shell rather than as a process of its own, so what the program printed stays, and the line can be
 * run again with the up arrow.
 */
export const runInTerminalAtom = atom(null, (get, set, line: string) => {
  const terminals = get(terminalsAtom);
  if (terminals[RUN_TERMINAL] === undefined) {
    set(terminalsAtom, { ...terminals, [RUN_TERMINAL]: { id: RUN_TERMINAL, name: RUN_TERMINAL } });
  }
  const pending = get(terminalInputAtom);
  set(terminalInputAtom, {
    ...pending,
    [RUN_TERMINAL]: [...(pending[RUN_TERMINAL] ?? []), `${line}\r`],
  });
  set(currentTerminalAtom, RUN_TERMINAL);
  set(dockTabAtom, 'terminal');
  set(dockOpenAtom, true);
});
