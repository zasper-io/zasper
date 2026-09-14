import { atom } from 'jotai';

// The file editor's cursor, which the status bar shows.
export const linePositionAtom = atom<number>(0);
export const columnPositionAtom = atom<number>(0);

export type LineEnding = 'LF' | 'CRLF';

export interface Indentation {
  indentWithTabs: boolean;
  tabSize: number;
}

/** How one open file is indented and how its lines end. Set when the file is read; changed from the status bar. */
export interface FileFormat extends Indentation {
  eol: LineEnding;
  /** The indentation the file's own lines use, for "Detect from the file"; null when there is none to tell by. */
  detected: Indentation | null;
  /**
   * Where the indentation came from. A file following the settings follows them when they change; one
   * indented by its .editorconfig, or by a choice made in the status bar, keeps its own.
   */
  source: 'editorconfig' | 'settings' | 'chosen';
}

/** Every open text file's format, by path. */
export const fileFormatsAtom = atom<Record<string, FileFormat>>({});
