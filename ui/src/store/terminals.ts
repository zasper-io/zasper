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
