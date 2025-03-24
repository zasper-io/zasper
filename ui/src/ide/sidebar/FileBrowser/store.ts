import { atom } from 'jotai';

export const showFileUploadDialogAtom = atom<boolean>(false);
export const fileUploadParentPathAtom = atom<string>('');
