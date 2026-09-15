import { search, SearchQuery } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { matchRanges } from './findHighlight';

const doc = 'row one\nrow two\nrow three\n';

function state(at = 0, head = at) {
  return EditorState.create({ doc, selection: { anchor: at, head }, extensions: [search()] });
}

describe('matchRanges', () => {
  it('finds every match in the range it is given', () => {
    const query = new SearchQuery({ search: 'row' });

    expect(matchRanges(state(), query, 0, doc.length).map((match) => match.from)).toEqual([
      0, 8, 16,
    ]);
    // Only what is on screen, which is what the plugin asks for one visible range at a time.
    expect(matchRanges(state(), query, 8, doc.length).map((match) => match.from)).toEqual([8, 16]);
  });

  it('marks the match the selection is on as the current one', () => {
    const query = new SearchQuery({ search: 'row' });

    const found = matchRanges(state(8, 11), query, 0, doc.length);

    expect(found.map((match) => match.current)).toEqual([false, true, false]);
  });

  it('has nothing to mark for a query the library cannot run', () => {
    expect(matchRanges(state(), new SearchQuery({ search: '' }), 0, doc.length)).toEqual([]);
    expect(
      matchRanges(state(), new SearchQuery({ search: '(', regexp: true }), 0, doc.length)
    ).toEqual([]);
  });
});
