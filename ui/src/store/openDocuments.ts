import { useEffect } from 'react';

/**
 * One replacement in a document an editor holds: a line from 1, UTF-16 columns in it, and the text the
 * search found there — which is checked before anything is written, because the editor may hold
 * unsaved changes the search, reading the disk, never saw.
 */
export interface LineEdit {
  /** In a notebook, which cell, from 0. */
  cell?: number;
  line: number;
  from: number;
  to: number;
  expected: string;
  insert: string;
}

export interface EditOutcome {
  applied: number;
  /** Edits whose text was no longer where the search found it, and so were left alone. */
  stale: number;
}

export interface OpenDocument {
  applyEdits: (edits: LineEdit[]) => EditOutcome;
  /** What the editor holds now, which is what its reader sees whether or not it has been saved. */
  text?: () => string;
}

const documents = new Map<string, OpenDocument>();

/**
 * Says that the editor for `path` carries out a project replace itself.
 *
 * A file open in an editor is replaced there rather than on disk, where the change would arrive as a
 * reload outside the undo history — or, in a notebook, be overwritten by its next save. A registry
 * rather than an atom, because the panel needs the outcome at the moment it asks.
 */
export function useOpenDocument(path: string, document: OpenDocument | null): void {
  useEffect(() => {
    if (document === null) {
      return;
    }
    documents.set(path, document);
    return () => {
      if (documents.get(path) === document) {
        documents.delete(path);
      }
    };
  }, [path, document]);
}

export function openDocument(path: string): OpenDocument | undefined {
  return documents.get(path);
}
