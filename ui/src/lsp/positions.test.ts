import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { offsetAt } from './positions';

const doc = Text.of(['package main', '😀 x := 1', '']);

describe('offsetAt', () => {
  it('counts a line from 0 and a column in UTF-16 units along it', () => {
    expect(offsetAt(doc, { line: 0, character: 8 })).toBe(8);
    // The emoji is two units, so `x` is at column 3 of the second line.
    expect(
      doc.sliceString(
        offsetAt(doc, { line: 1, character: 3 }),
        offsetAt(doc, { line: 1, character: 4 })
      )
    ).toBe('x');
  });

  it('holds a position past the end of a line, or of the document, inside it', () => {
    expect(offsetAt(doc, { line: 0, character: 99 })).toBe(12);
    expect(offsetAt(doc, { line: 7, character: 0 })).toBe(doc.length);
    expect(offsetAt(doc, { line: -1, character: 4 })).toBe(0);
  });
});
