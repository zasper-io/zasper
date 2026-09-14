import { atom } from 'jotai';

/** Bumped by the About command, and read by the Help tab as a request to scroll to About. */
export const helpAboutRequestAtom = atom<number>(0);
