// State private to the file browser. Both atoms are read and written only by the
// components in this folder, so they stay here rather than in src/store/, which is
// for state shared across features.

import { atom } from 'jotai';

export const showFileUploadDialogAtom = atom<boolean>(false);
export const fileUploadParentPathAtom = atom<string>('');
