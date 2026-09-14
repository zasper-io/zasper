import { atom } from 'jotai';

/** The current branch: the git panel reads it and the status bar shows it. */
export const branchNameAtom = atom<string>('');
