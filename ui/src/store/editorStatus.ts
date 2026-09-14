import { atom } from 'jotai';

// The file editor's cursor and indentation, which the status bar shows.

export const linePositionAtom = atom<number>(0);
export const columnPositionAtom = atom<number>(0);
export const encodingAtom = atom<string>('UTF-8');
export const eolSequenceAtom = atom<string>('LF');
export const indentationModeAtom = atom<string>('Spaces');
export const indentationSizeAtom = atom<number>(2);
