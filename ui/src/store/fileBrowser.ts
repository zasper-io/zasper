import { atom } from 'jotai';

/** Bumped to make the file browser read its root again, by whatever just created something there. */
export const fileBrowserReloadCountAtom = atom<number>(0);
