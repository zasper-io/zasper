import { search } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { countLabel, countMatches, FindOptions, findQuery } from './findMatches';

const options = (overrides: Partial<FindOptions> = {}): FindOptions => ({
  search: 'row',
  replace: '',
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  ...overrides,
});

/** A document with three matches, and the cursor where the test puts it. */
function state(doc = 'row one\nROW two\nrow three\n', at = 0) {
  return EditorState.create({ doc, selection: { anchor: at }, extensions: [search()] });
}

describe('findQuery', () => {
  it('has nothing to look for when the field is empty', () => {
    expect(findQuery(options({ search: '' }))).toBeNull();
  });

  // What someone typing `(\w+)` has for as long as it takes to type the rest of it.
  it('refuses a regular expression that does not parse', () => {
    expect(findQuery(options({ search: '(', regexp: true }))).toBeNull();
    expect(findQuery(options({ search: '(\\w+)', regexp: true }))).not.toBeNull();
  });
});

describe('countMatches', () => {
  it('counts them, and says which one the cursor is at', () => {
    const query = findQuery(options())!;

    expect(countMatches(state(), query)).toEqual({ total: 3, current: 1, capped: false });
    // With the cursor on the second line, the second match is the one it is at.
    expect(countMatches(state(undefined, 8), query).current).toBe(2);
  });

  it('wraps to the first match once the cursor is past the last', () => {
    const query = findQuery(options())!;

    // Past the start of the third match, which is the last one there is.
    expect(countMatches(state(undefined, 20), query)).toMatchObject({ total: 3, current: 1 });
  });

  it('counts only the ones that match the case when it is asked to', () => {
    const query = findQuery(options({ caseSensitive: true }))!;

    expect(countMatches(state(), query).total).toBe(2);
  });

  it('stops at the cap, and says that it did', () => {
    const query = findQuery(options({ search: 'x' }))!;

    const counted = countMatches(state('x'.repeat(50)), query, 10);

    expect(counted).toEqual({ total: 10, current: 1, capped: true });
  });
});

describe('countLabel', () => {
  it('says where the cursor is among the matches', () => {
    expect(countLabel(options(), { total: 58, current: 2, capped: false })).toBe('2 of 58');
    expect(countLabel(options(), { total: 2000, current: 1, capped: true })).toBe('1 of 2000+');
  });

  it('says nothing at all until something is typed', () => {
    expect(countLabel(options({ search: '' }), null)).toBe('');
  });

  it('tells a pattern that cannot be read from one that finds nothing', () => {
    expect(countLabel(options({ search: '(', regexp: true }), null)).toBe('Bad pattern');
    expect(countLabel(options(), null)).toBe('No results');
    expect(countLabel(options(), { total: 0, current: 0, capped: false })).toBe('No results');
  });
});
