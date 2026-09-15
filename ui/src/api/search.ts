import { requestJson, requestLines } from './client';
import { ContentEntry } from './contents';

/** Returns the files whose name contains `query`. */
export function searchFiles(query: string): Promise<ContentEntry[]> {
  return requestJson<ContentEntry[]>('/api/files', { query: { query } });
}

/** What the search panel asks the server to look for. */
export interface ContentQuery {
  pattern: string;
  case_sensitive: boolean;
  whole_word: boolean;
  regexp: boolean;
  /** Comma-separated globs. */
  include: string;
  exclude: string;
  /** When set, every range says what replacing it would write. */
  replace?: string;
}

/** One match, in UTF-16 code units from the start of its line: the editor's own positions. */
export interface SearchRange {
  from: number;
  to: number;
  replacement?: string;
}

export interface SearchLine {
  /** From 1: in the file, or in a notebook cell's source or output. */
  line: number;
  /** The line, or the stretch of a very long one around its first match, which starts at `offset`. */
  text: string;
  offset: number;
  ranges: SearchRange[];
  /** In a notebook, which cell, from 0. */
  cell?: number;
  /** In what the cell printed, which is searched and never replaced. */
  output?: boolean;
}

export interface SearchFile {
  path: string;
  kind: 'file' | 'notebook';
  lines: SearchLine[];
}

export interface SearchSummary {
  files: number;
  matches: number;
  /** The search stopped at the server's cap, so there are more matches than it sent. */
  capped: boolean;
}

/** One match, named the way the server can find it again. */
export interface MatchKey {
  cell?: number;
  line: number;
  from: number;
}

interface SearchEvent {
  file?: SearchFile;
  done?: SearchSummary;
}

/**
 * Searches the project's contents, handing over each file as the server finds it. Resolves to the
 * summary once the search is over; aborting `signal` cancels it on the server too.
 */
export async function searchContents(
  query: ContentQuery,
  onFile: (file: SearchFile) => void,
  signal?: AbortSignal
): Promise<SearchSummary | null> {
  let summary: SearchSummary | null = null;
  await requestLines<SearchEvent>(
    '/api/search',
    { method: 'POST', body: query, signal },
    (event) => {
      if (event.file !== undefined) {
        onFile(event.file);
      }
      if (event.done !== undefined) {
        summary = event.done;
      }
    }
  );
  return summary;
}

export interface ReplacePreview {
  original: string;
  replaced: string;
}

/** A text file as it is on disk and as a replace would leave it. Writes nothing. */
export function previewReplace(
  query: ContentQuery,
  path: string,
  skip: MatchKey[]
): Promise<ReplacePreview> {
  return requestJson<ReplacePreview>('/api/search/preview', {
    method: 'POST',
    body: { query, path, skip },
  });
}

export interface ReplaceOutcome {
  files: number;
  replacements: number;
  failed: { path: string; message: string }[];
}

/** Writes a replace into files that are not open, leaving out the matches in each file's `skip`. */
export function replaceInFiles(
  query: ContentQuery,
  files: { path: string; skip: MatchKey[] }[]
): Promise<ReplaceOutcome> {
  return requestJson<ReplaceOutcome>('/api/search/replace', {
    method: 'POST',
    body: { query, files },
  });
}
