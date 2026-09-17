import { atom } from 'jotai';

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
 * A terminal was a tab until story 4, so the tab strip answered this; in the panel under the editor the
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

  // The one before it, as closing a tab comes back to its neighbour rather than to the top of the
  // strip; the one after it when the first was closed, and nothing when that was the last shell.
  if (get(currentTerminalAtom) === name) {
    const closed = names.indexOf(name);
    set(currentTerminalAtom, names[closed - 1] ?? names[closed + 1] ?? '');
  }
});
