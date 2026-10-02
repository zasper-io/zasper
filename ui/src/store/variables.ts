import { atom } from 'jotai';

/** Bumped by the panel's refresh button: the list is otherwise read again only after a run. */
export const variablesReloadAtom = atom(0);
