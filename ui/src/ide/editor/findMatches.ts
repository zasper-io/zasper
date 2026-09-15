import { SearchQuery } from '@codemirror/search';
import { EditorState } from '@codemirror/state';

/** What the find card is asking for. */
export interface FindOptions {
  search: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

/**
 * The query CodeMirror searches with, or null for one it cannot: an empty field, or a regular
 * expression that does not parse — which is what someone typing `(` has for as long as it takes to
 * type the rest.
 */
export function findQuery(options: FindOptions): SearchQuery | null {
  const query = new SearchQuery(options);
  return query.valid ? query : null;
}

export interface MatchCount {
  total: number;
  /** Which match the cursor is in or before, from 1; 0 when there are none. */
  current: number;
  /** Whether counting stopped at the cap, so the total is a floor rather than the number. */
  capped: boolean;
}

/**
 * How many matches the document holds, and which one the cursor is at.
 *
 * Counted rather than asked for, because CodeMirror's search keeps no count: it steps from one match to
 * the next and never needs to know. The cap is what keeps a three-character query in a large file from
 * walking the whole thing on every keystroke.
 */
export function countMatches(state: EditorState, query: SearchQuery, cap = 2000): MatchCount {
  const cursor = query.getCursor(state);
  const head = state.selection.main.from;
  let total = 0;
  let current = 0;

  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++;
    // The first match that starts at or after the cursor: after a step, that is the match itself.
    if (current === 0 && next.value.from >= head) {
      current = total;
    }
    if (total >= cap) {
      return { total, current: current === 0 ? 1 : current, capped: true };
    }
  }

  // Past the last match, the next step wraps to the first, so that is where the cursor is headed.
  return { total, current: current === 0 && total > 0 ? 1 : current, capped: false };
}

/** What the card says beside the field: a position, a refusal, or nothing at all. */
export function countLabel(options: FindOptions, counted: MatchCount | null): string {
  if (options.search === '') {
    return '';
  }
  if (counted === null) {
    return options.regexp ? 'Bad pattern' : 'No results';
  }
  if (counted.total === 0) {
    return 'No results';
  }
  return `${counted.current} of ${counted.total}${counted.capped ? '+' : ''}`;
}
