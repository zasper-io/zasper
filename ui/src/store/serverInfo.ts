import { atom } from 'jotai';

// What /api/info says about the server and the project it serves.

export const zasperVersionAtom = atom<string>('');
/** `darwin · arm64`, for the Help tab's About block. */
export const platformAtom = atom<string>('');
/** The project directory's last segment, upper-cased for display. */
export const projectNameAtom = atom<string>('');
/**
 * The project directory's absolute path, `''` until /api/info answers. The name alone is not an
 * identity, and this is what tells one project's remembered tabs from another's.
 */
export const projectDirAtom = atom<string>('');
/** The server's operating system: terminals cannot run on `windows`. */
export const serverOsAtom = atom<string>('');
export const terminalsAvailableAtom = atom((get) => get(serverOsAtom) !== 'windows');
export const userNameAtom = atom<string>('');
