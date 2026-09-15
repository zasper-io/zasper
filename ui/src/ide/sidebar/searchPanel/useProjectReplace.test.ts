import { describe, expect, it } from 'vitest';

import { SearchFile } from '@/api';

import { editsFor, skippedKeys } from './useProjectReplace';

const notebook: SearchFile = {
  path: 'analysis.ipynb',
  kind: 'notebook',
  lines: [
    {
      line: 2,
      text: 'frame = frame.dropna()',
      offset: 0,
      cell: 1,
      ranges: [
        { from: 0, to: 5, replacement: 'table' },
        { from: 8, to: 13, replacement: 'table' },
      ],
    },
    {
      line: 1,
      text: 'frame has 20160 rows',
      offset: 0,
      cell: 1,
      output: true,
      ranges: [{ from: 0, to: 5, replacement: 'table' }],
    },
  ],
};

describe('editsFor', () => {
  it('replaces what a cell holds, and never what it printed', () => {
    expect(editsFor({ file: notebook, lines: notebook.lines })).toEqual([
      { cell: 1, line: 2, from: 0, to: 5, expected: 'frame', insert: 'table' },
      { cell: 1, line: 2, from: 8, to: 13, expected: 'frame', insert: 'table' },
    ]);
  });
});

describe('skippedKeys', () => {
  it('names the matches of the file the target leaves out, so the server skips them', () => {
    const [source] = notebook.lines;
    const onlyTheSecond = { ...source, ranges: [source.ranges[1]] };

    expect(skippedKeys({ file: notebook, lines: [onlyTheSecond] })).toEqual([
      { cell: 1, line: 2, from: 0 },
    ]);
  });
});
