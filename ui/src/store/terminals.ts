import { atom } from 'jotai';

export interface TerminalRef {
  name: string;
  id: string;
}

export interface TerminalRefs {
  [key: string]: TerminalRef;
}

/** The terminals this window has open, by the name of their tab. */
export const terminalsAtom = atom<TerminalRefs>({});
export const terminalsCountAtom = atom<number>(0);
