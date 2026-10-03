import { describe, expect, it } from 'vitest';

import {
  DiffCell,
  diffNotebooks,
  lineDiff,
  matchCells,
  NotebookSide,
  outputsAsText,
} from './cellDiff';

const code = (source: string, extra: Partial<DiffCell> = {}): DiffCell => ({
  cell_type: 'code',
  source,
  outputs: [],
  metadata: {},
  ...extra,
});
const side = (cells: DiffCell[]): NotebookSide => ({ cells, metadata: {}, nbformat_minor: 5 });

describe('lineDiff', () => {
  it('lines up the same lines and marks the words that changed in a changed one', () => {
    const lines = lineDiff('a = load("1min")\nb = 2\n', 'a = load("5min")\nb = 2\nc = 3\n');

    expect(lines.map((line) => [line.kind, line.oldNumber, line.newNumber, line.text])).toEqual([
      ['removed', 1, undefined, 'a = load("1min")'],
      ['added', undefined, 1, 'a = load("5min")'],
      ['same', 2, 2, 'b = 2'],
      ['added', undefined, 3, 'c = 3'],
    ]);
    const [removed, added] = lines;
    expect(removed.marks?.map(([from, to]) => removed.text.slice(from, to))).toEqual(['1min']);
    expect(added.marks?.map(([from, to]) => added.text.slice(from, to))).toEqual(['5min']);
  });

  it('marks whole words, even where only some letters differ', () => {
    const [removed, added] = lineDiff('x.mean().diff()\n', 'x.median().diff()\n');
    expect(removed.marks?.map(([from, to]) => removed.text.slice(from, to))).toEqual(['mean']);
    expect(added.marks?.map(([from, to]) => added.text.slice(from, to))).toEqual(['median']);
  });
});

describe('matchCells', () => {
  it('matches by id, wherever a cell went', () => {
    const before = [code('x', { id: 'a' }), code('y', { id: 'b' }), code('z', { id: 'c' })];
    const after = [code('z', { id: 'c' }), code('x', { id: 'a' }), code('y edited', { id: 'b' })];

    expect(matchCells(before, after)).toEqual([
      [2, 0],
      [0, 1],
      [1, 2],
    ]);
  });

  it('matches by source without ids: the same first, then the most alike', () => {
    const before = [code('import pandas'), code('df = load(1)'), code('df.plot()')];
    const after = [code('import pandas'), code('new = 1'), code('df = load(5)'), code('df.plot()')];

    expect(matchCells(before, after)).toEqual([
      [0, 0],
      [1, 2],
      [2, 3],
    ]);
  });
});

describe('diffNotebooks', () => {
  it('says what happened to each cell, and moves are not a delete and an add', () => {
    const before = side([
      code('one', { id: 'a' }),
      code('two', { id: 'b' }),
      code('three', { id: 'c' }),
      code('gone', { id: 'd' }),
    ]);
    const after = side([
      code('three', { id: 'c' }),
      code('one', { id: 'a' }),
      code('two!', { id: 'b' }),
      code('new', { id: 'e' }),
    ]);

    const changes = diffNotebooks(before, after).cells.map((cell) => [
      cell.change,
      cell.old?.index,
      cell.new?.index,
    ]);
    expect(changes).toEqual([
      ['moved', 2, 0],
      ['unchanged', 0, 1],
      ['edited', 1, 2],
      ['removed', 3, undefined],
      ['added', undefined, 3],
    ]);
  });

  it('finds a moved cell without ids, by its source', () => {
    const before = side([code('alpha'), code('beta'), code('gamma')]);
    const after = side([code('gamma'), code('alpha'), code('beta')]);

    const moved = diffNotebooks(before, after).cells.filter((cell) => cell.change === 'moved');
    expect(moved.map((cell) => cell.new?.cell.source)).toEqual(['gamma']);
  });

  it('counts a re-run as outputs changed, and execution counts and table ids as nothing', () => {
    const plot = (seed: string) => ({
      output_type: 'execute_result',
      execution_count: Number(seed.length),
      data: { 'text/plain': seed, 'application/vnd.zasper.dataframe+json': { id: seed } },
      metadata: {},
    });
    const before = side([
      code('df', { id: 'a', execution_count: 1, outputs: [plot('x')] }),
      code('df.plot()', { id: 'b', execution_count: 2, outputs: [plot('old')] }),
    ]);
    const after = side([
      code('df', { id: 'a', execution_count: 7, outputs: [{ ...plot('x'), execution_count: 7 }] }),
      code('df.plot()', { id: 'b', execution_count: 8, outputs: [plot('new')] }),
    ]);

    expect(diffNotebooks(before, after).cells.map((cell) => cell.change)).toEqual([
      'unchanged',
      'outputs',
    ]);
  });

  it('ignores what a frontend writes for itself in metadata, and not what a person did', () => {
    const before = side([code('x', { id: 'a', metadata: { collapsed: false } })]);
    const after = side([code('x', { id: 'a', metadata: { collapsed: true, tags: ['keep'] } })]);

    const [cell] = diffNotebooks(before, after).cells;
    expect(cell.change).toBe('outputs');
    expect(cell.metadataChanged).toBe(true);
    expect(cell.outputsChanged).toBe(false);
  });

  it('reads an added notebook as every cell added', () => {
    const cells = diffNotebooks(null, side([code('a'), code('b')])).cells;
    expect(cells.map((cell) => cell.change)).toEqual(['added', 'added']);
  });
});

describe('outputsAsText', () => {
  it('is the printed text, or null once any output is more than text', () => {
    expect(
      outputsAsText(
        code('', {
          outputs: [
            { output_type: 'stream', name: 'stdout', text: 'a\n' },
            { output_type: 'execute_result', data: { 'text/plain': '42' }, metadata: {} },
          ],
        })
      )
    ).toBe('a\n42\n');
    expect(
      outputsAsText(
        code('', {
          outputs: [{ output_type: 'display_data', data: { 'image/png': 'AAA' }, metadata: {} }],
        })
      )
    ).toBeNull();
  });
});
