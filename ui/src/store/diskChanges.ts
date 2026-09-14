import { atom } from 'jotai';

/** The key the comparison of a file against its version on disk is opened under. */
export function diskCompareTabKey(path: string): string {
  return `disk:${path}`;
}

/** What a file's Compare opened: the version on disk and the editor's text, as they were then. */
export interface DiskCompare {
  onDisk: string;
  mine: string;
}

export const diskComparesAtom = atom<Record<string, DiskCompare>>({});

/** An answer given in the comparison tab, for the file's own editor to carry out. */
export type DiskResolution = 'mine' | 'theirs';

export const diskResolutionsAtom = atom<Record<string, DiskResolution>>({});

/** The file a comparison tab is about, from the tab's key. */
export function diskComparePath(key: string): string {
  return key.slice('disk:'.length);
}
