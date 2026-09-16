import { atom } from 'jotai';

/** One place a name is used, in a file's own lines. */
export interface ReferencePlace {
  /** From 0, as the protocol counts. */
  line: number;
  character: number;
  /** Where the name ends on that line, for the mark on the row. */
  endCharacter: number;
  /** The line as it reads, or empty when the file could not be read. */
  text: string;
  /** This is where the name is defined, which the row says. */
  definition: boolean;
}

export interface ReferenceFile {
  path: string;
  places: ReferencePlace[];
}

/** What the References tab is showing: one question, asked of one file, and its answer. */
export interface ReferenceSearch {
  /** The name asked about. */
  symbol: string;
  /** The file it was asked from, which is what the tab is about until another question is asked. */
  from: string;
  state: 'asking' | 'answered' | 'unanswered';
  files: ReferenceFile[];
  total: number;
  /** Why there is no answer: no server for the language, or the server refused. */
  message?: string;
}

export const referencesAtom = atom<ReferenceSearch | null>(null);
