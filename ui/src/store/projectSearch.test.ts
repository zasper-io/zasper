import { describe, expect, it } from 'vitest';

import { SearchFile, SearchLine } from '@/api';

import { matchId, NO_RESULTS, rowPieces, shownLines, summaryText } from './projectSearch';

const line = (text: string, from: number, to: number, offset = 0): SearchLine => ({
  line: 1,
  text,
  offset,
  ranges: [{ from, to }],
});

describe('rowPieces', () => {
  it('drops the indentation in front of a match near the start', () => {
    expect(rowPieces(line('    frame = load()', 4, 9))).toEqual({
      cut: false,
      pieces: [{ text: 'frame', range: { from: 4, to: 9 } }, { text: ' = load()' }],
    });
  });

  it('starts a line whose match is far along a few characters before it', () => {
    const text = `${'x'.repeat(40)} frame`;
    const { cut, pieces } = rowPieces(line(text, 41, 46));

    expect(cut).toBe(true);
    expect(pieces[0].text).toHaveLength(12);
    expect(pieces[1]).toEqual({ text: 'frame', range: { from: 41, to: 46 } });
  });

  // The server sends the stretch of a very long line around its match, and the ranges still count from
  // the line's start.
  it('reads ranges against the stretch of a long line that was sent', () => {
    const { cut, pieces } = rowPieces(line('ab frame cd', 1003, 1008, 1000));

    expect(cut).toBe(true);
    expect(pieces).toEqual([
      { text: 'ab ' },
      { text: 'frame', range: { from: 1003, to: 1008 } },
      { text: ' cd' },
    ]);
  });
});

describe('shownLines', () => {
  const file: SearchFile = {
    path: 'a.py',
    kind: 'file',
    lines: [
      {
        line: 1,
        text: 'frame frame',
        offset: 0,
        ranges: [
          { from: 0, to: 5 },
          { from: 6, to: 11 },
        ],
      },
      line('frame', 0, 5),
    ],
  };
  file.lines[1].line = 2;

  it('takes out the matches left out, and the lines left with none', () => {
    const leftOut = {
      files: [],
      matches: [
        matchId('a.py', file.lines[0], file.lines[0].ranges[1]),
        matchId('a.py', file.lines[1], file.lines[1].ranges[0]),
      ],
    };

    expect(shownLines(file, leftOut)).toEqual([{ ...file.lines[0], ranges: [{ from: 0, to: 5 }] }]);
  });

  it('shows nothing of a file left out', () => {
    expect(shownLines(file, { files: ['a.py'], matches: [] })).toEqual([]);
  });
});

describe('summaryText', () => {
  const done = (matches: number, files: number, capped = false) => ({
    ...NO_RESULTS,
    summary: { matches, files, capped },
  });

  it('counts what is shown, in words', () => {
    expect(summaryText(done(14, 4), { matches: 14, files: 4 })).toBe('14 results in 4 files');
    expect(summaryText(done(1, 1), { matches: 1, files: 1 })).toBe('1 result in 1 file');
  });

  it('says a capped search is cut, and how to see the rest', () => {
    expect(summaryText(done(2000, 30, true), { matches: 2000, files: 30 })).toBe(
      '2,000 results — the first 2,000. Narrow the search to see the rest.'
    );
  });

  it('says what a search that found nothing did not look at', () => {
    expect(summaryText(done(0, 0), { matches: 0, files: 0 })).toBe(
      'No results. Files that .gitignore ignores are not searched.'
    );
  });

  it('says a search is still going, and why there is nothing', () => {
    expect(summaryText({ ...NO_RESULTS, searching: true }, { matches: 0, files: 0 })).toBe(
      'Searching…'
    );
    expect(summaryText({ ...NO_RESULTS, searching: true }, { matches: 3, files: 1 })).toBe(
      'Searching… 3 results so far'
    );
    expect(
      summaryText(
        { ...NO_RESULTS, error: 'Bad pattern: missing closing )' },
        { matches: 0, files: 0 }
      )
    ).toBe('Bad pattern: missing closing )');
  });
});
