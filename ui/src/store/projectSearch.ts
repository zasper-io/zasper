import { atom } from 'jotai';

import { ContentQuery, MatchKey, SearchFile, SearchLine, SearchRange, SearchSummary } from '@/api';

/**
 * What the search panel is asking for. In the store rather than in the panel, because the
 * replace preview tab reads the same query and the same left-out matches.
 */
export interface SearchOptions {
  pattern: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  include: string;
  exclude: string;
  /** Whether the replace row is open: rows then show the replacement, and a pressed row its diff. */
  replacing: boolean;
}

export const NO_SEARCH: SearchOptions = {
  pattern: '',
  replace: '',
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  include: '',
  exclude: '',
  replacing: false,
};

export const searchOptionsAtom = atom<SearchOptions>(NO_SEARCH);

export interface SearchResults {
  files: SearchFile[];
  summary: SearchSummary | null;
  searching: boolean;
  /** Why there is nothing to show, such as a pattern that does not parse. */
  error: string;
}

export const NO_RESULTS: SearchResults = { files: [], summary: null, searching: false, error: '' };

export const searchResultsAtom = atom<SearchResults>(NO_RESULTS);

/** What the reader has taken out of the results: whole files by path, single matches by `matchId`. */
export interface LeftOut {
  files: string[];
  matches: string[];
}

export const leftOutAtom = atom<LeftOut>({ files: [], matches: [] });

/** Bumped to search again with the same query, as after a replace has changed the files. */
export const searchRerunAtom = atom(0);

/** The key the diff of a file against itself after replacing is opened under. */
export function searchPreviewTabKey(path: string): string {
  return `search-preview:${path}`;
}

/** The file a replace preview tab is about, from the tab's key. */
export function searchPreviewPath(key: string): string {
  return key.slice('search-preview:'.length);
}

/** Bumped by ⇧⌘F, which takes the panel's field. */
export const searchFocusRequestAtom = atom(0);

/**
 * A match pressed in the panel, for the editor holding its file to show: the cursor on it and the
 * editor's own find card searching for the same thing. Cleared by the editor that takes it.
 */
export interface MatchReveal {
  path: string;
  line: number;
  from: number;
  to: number;
  cell?: number;
  output?: boolean;
  search: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export const revealMatchAtom = atom<MatchReveal | null>(null);

export function contentQuery(options: SearchOptions): ContentQuery {
  return {
    pattern: options.pattern,
    case_sensitive: options.caseSensitive,
    whole_word: options.wholeWord,
    regexp: options.regexp,
    include: options.include,
    exclude: options.exclude,
    ...(options.replacing ? { replace: options.replace } : {}),
  };
}

export function matchId(path: string, line: SearchLine, range: SearchRange): string {
  return [
    path,
    line.cell ?? '',
    line.output === true ? 'output' : 'source',
    line.line,
    range.from,
  ].join('\n');
}

export function matchKeyOf(line: SearchLine, range: SearchRange): MatchKey {
  return line.cell === undefined
    ? { line: line.line, from: range.from }
    : { cell: line.cell, line: line.line, from: range.from };
}

/** The text a match covers, read out of the line the server sent. */
export function matchedText(line: SearchLine, range: SearchRange): string {
  return line.text.slice(range.from - line.offset, range.to - line.offset);
}

/** A file's lines with the left-out matches taken out, and the lines left with none dropped. */
export function shownLines(file: SearchFile, leftOut: LeftOut): SearchLine[] {
  if (leftOut.files.includes(file.path)) {
    return [];
  }
  const dropped = new Set(leftOut.matches);
  return file.lines
    .map((line) => ({
      ...line,
      ranges: line.ranges.filter((range) => !dropped.has(matchId(file.path, line, range))),
    }))
    .filter((line) => line.ranges.length > 0);
}

export function countRanges(lines: SearchLine[]): number {
  return lines.reduce((total, line) => total + line.ranges.length, 0);
}

export interface RowPiece {
  text: string;
  range?: SearchRange;
}

/** How far into a line its first match can be before the row starts closer to it. */
const LEAD = 24;
/** How much of the line is kept in front of the match when it does. */
const KEPT = 12;

/**
 * What a row shows of its line, cut into plain text and matches. A row is the panel's width, so a line
 * whose first match is far along starts a few characters before it, behind an ellipsis; indentation
 * is dropped either way, because it only pushes the match off the row.
 */
export function rowPieces(line: SearchLine): { cut: boolean; pieces: RowPiece[] } {
  const text = line.text;
  const first = line.ranges.length > 0 ? line.ranges[0].from - line.offset : 0;
  const indent = text.length - text.trimStart().length;
  const start = first - indent > LEAD ? first - KEPT : Math.min(indent, first);

  const pieces: RowPiece[] = [];
  let at = start;
  for (const range of line.ranges) {
    const from = Math.max(range.from - line.offset, at);
    const to = Math.min(range.to - line.offset, text.length);
    if (to <= from) {
      continue;
    }
    if (from > at) {
      pieces.push({ text: text.slice(at, from) });
    }
    pieces.push({ text: text.slice(from, to), range });
    at = to;
  }
  if (at < text.length) {
    pieces.push({ text: text.slice(at) });
  }
  return { cut: start > indent || line.offset > 0, pieces };
}

function counted(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

/** The line under the form: what the list holds, or why it holds nothing. */
export function summaryText(
  results: SearchResults,
  shown: { files: number; matches: number }
): string {
  if (results.error !== '') {
    return results.error;
  }
  if (results.searching) {
    return shown.matches === 0
      ? 'Searching…'
      : `Searching… ${counted(shown.matches, 'result')} so far`;
  }
  if (results.summary === null) {
    return '';
  }
  if (results.summary.capped) {
    const cap = results.summary.matches.toLocaleString('en-US');
    return `${cap} results — the first ${cap}. Narrow the search to see the rest.`;
  }
  if (shown.matches === 0) {
    return 'No results. Files that .gitignore ignores are not searched.';
  }
  return `${counted(shown.matches, 'result')} in ${counted(shown.files, 'file')}`;
}
