import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { editedText, lineEditChanges } from './lineEdits';

const edit = (line: number, from: number, to: number, expected: string, insert: string) => ({
  line,
  from,
  to,
  expected,
  insert,
});

describe('lineEditChanges', () => {
  it('places an edit by its line and its column in that line', () => {
    const doc = Text.of(['import pandas', 'frame = frame.dropna()']);

    const { changes, stale } = lineEditChanges(doc, [
      edit(2, 0, 5, 'frame', 'table'),
      edit(2, 8, 13, 'frame', 'table'),
    ]);

    expect(stale).toBe(0);
    expect(changes).toEqual([
      { from: 14, to: 19, insert: 'table' },
      { from: 22, to: 27, insert: 'table' },
    ]);
  });

  // The search read the disk; an editor with unsaved changes can hold something else at that spot.
  it('leaves alone an edit whose text is no longer where the search found it', () => {
    const doc = Text.of(['frames = 1', 'short']);

    const { changes, stale } = lineEditChanges(doc, [
      edit(1, 0, 5, 'table', 'x'),
      edit(2, 0, 9, 'something', 'x'),
      edit(9, 0, 1, 'a', 'x'),
    ]);

    expect(changes).toEqual([]);
    expect(stale).toBe(3);
  });
});

describe('editedText', () => {
  it('carries the edits out on a string', () => {
    expect(editedText('# The frame\nframe', [edit(1, 6, 11, 'frame', 'table')])).toEqual({
      text: '# The table\nframe',
      applied: 1,
      stale: 0,
    });
  });
});
