import { describe, expect, it } from 'vitest';

import { DocumentSymbol, kindGlyph, symbolSiblings, symbolTrail } from './symbols';

function symbol(
  name: string,
  line: number,
  endLine: number,
  children: DocumentSymbol[] = []
): DocumentSymbol {
  return { name, kind: 12, line, character: 5, endLine, children };
}

const FILE = [
  symbol('Greeter', 0, 8, [symbol('Prefix', 1, 1), symbol('greet', 3, 7)]),
  symbol('main', 10, 20),
];

describe('symbolTrail', () => {
  it('follows the nesting to the innermost symbol holding a line', () => {
    expect(symbolTrail(FILE, 4).map((each) => each.name)).toEqual(['Greeter', 'greet']);
  });

  it('is one deep where nothing nests', () => {
    expect(symbolTrail(FILE, 12).map((each) => each.name)).toEqual(['main']);
  });

  // A file's imports are inside nothing, and the bar is then the path alone.
  it('is empty for a line inside nothing', () => {
    expect(symbolTrail(FILE, 9)).toEqual([]);
  });
});

describe('symbolSiblings', () => {
  it('offers the file’s own symbols for the first crumb', () => {
    const trail = symbolTrail(FILE, 4);

    expect(symbolSiblings(FILE, trail, 0).map((each) => each.name)).toEqual(['Greeter', 'main']);
  });

  it('offers what sits beside a nested symbol', () => {
    const trail = symbolTrail(FILE, 4);

    expect(symbolSiblings(FILE, trail, 1).map((each) => each.name)).toEqual(['Prefix', 'greet']);
  });
});

describe('kindGlyph', () => {
  // Three shapes rather than twenty-six: something that runs, something with parts, something else.
  it('draws a function, a struct and a variable differently', () => {
    expect(kindGlyph(12)).toBe('ƒ');
    expect(kindGlyph(23)).toBe('◇');
    expect(kindGlyph(13)).toBe('•');
  });
});
