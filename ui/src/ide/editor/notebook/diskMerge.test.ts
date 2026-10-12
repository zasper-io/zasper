import { describe, expect, it } from 'vitest';

import { NotebookCell, NotebookModel } from '@/api';
import { mergeFromDisk } from './diskMerge';

function cell(id: string, source: string, outputs: NotebookCell['outputs'] = []): NotebookCell {
  return {
    id,
    cell_type: 'code',
    source,
    metadata: {},
    outputs,
    execution_count: null,
    reload: false,
  };
}

function notebook(...cells: NotebookCell[]): NotebookModel {
  return { cells, metadata: {}, nbformat: 4, nbformat_minor: 5 };
}

const sources = (model: NotebookModel) => model.cells.map((each) => `${each.id}:${each.source}`);

describe('mergeFromDisk', () => {
  const base = notebook(cell('a', 'load()'), cell('b', 'fit()'), cell('c', 'plot()'));

  it('takes the file’s version of a cell the reader has not touched', () => {
    const theirs = notebook(cell('a', 'load("clean")'), cell('b', 'fit()'), cell('c', 'plot()'));

    const merged = mergeFromDisk(base, base, theirs, null)!;

    expect(sources(merged.notebook)).toEqual(['a:load("clean")', 'b:fit()', 'c:plot()']);
    expect(merged.conflicts).toEqual({});
    expect(merged.takenIn).toBe(1);
  });

  it('keeps the reader’s edit to a cell the file did not change', () => {
    const mine = notebook(cell('a', 'load()'), cell('b', 'fit(folds=5)'), cell('c', 'plot()'));
    const theirs = notebook(cell('a', 'load("clean")'), cell('b', 'fit()'), cell('c', 'plot()'));

    const merged = mergeFromDisk(base, mine, theirs, null)!;

    expect(sources(merged.notebook)).toEqual(['a:load("clean")', 'b:fit(folds=5)', 'c:plot()']);
    expect(merged.conflicts).toEqual({});
  });

  it('keeps the very same cell object when nothing about it changed', () => {
    const theirs = notebook(cell('a', 'load("clean")'), cell('b', 'fit()'), cell('c', 'plot()'));

    const merged = mergeFromDisk(base, base, theirs, null)!;

    expect(merged.notebook.cells[1]).toBe(base.cells[1]);
  });

  it('keeps the reader’s version of a cell both changed, and the file’s beside it', () => {
    const mine = notebook(cell('a', 'load()'), cell('b', 'fit(folds=5)'), cell('c', 'plot()'));
    const theirs = notebook(cell('a', 'load()'), cell('b', 'fit(folds=3)'), cell('c', 'plot()'));

    const merged = mergeFromDisk(base, mine, theirs, null)!;

    expect(sources(merged.notebook)).toContain('b:fit(folds=5)');
    expect(merged.conflicts.b?.source).toBe('fit(folds=3)');
  });

  it('asks nothing when both made the same change', () => {
    const same = notebook(cell('a', 'load()'), cell('b', 'fit(folds=5)'), cell('c', 'plot()'));

    expect(mergeFromDisk(base, same, same, null)!.conflicts).toEqual({});
  });

  it('places a cell added on disk after the cell it follows there', () => {
    const mine = notebook(
      cell('a', 'load()'),
      cell('mine', 'mine()'),
      cell('b', 'fit()'),
      cell('c', 'plot()')
    );
    const theirs = notebook(
      cell('a', 'load()'),
      cell('b', 'fit()'),
      cell('new', 'describe()'),
      cell('c', 'plot()')
    );

    const merged = mergeFromDisk(base, mine, theirs, null)!;

    expect(sources(merged.notebook)).toEqual([
      'a:load()',
      'mine:mine()',
      'b:fit()',
      'new:describe()',
      'c:plot()',
    ]);
  });

  it('removes a cell deleted on disk, unless the reader changed it', () => {
    const theirs = notebook(cell('a', 'load()'), cell('c', 'plot()'));
    const edited = notebook(cell('a', 'load()'), cell('b', 'fit(folds=5)'), cell('c', 'plot()'));

    expect(sources(mergeFromDisk(base, base, theirs, null)!.notebook)).toEqual([
      'a:load()',
      'c:plot()',
    ]);
    const kept = mergeFromDisk(base, edited, theirs, null)!;
    expect(sources(kept.notebook)).toContain('b:fit(folds=5)');
    expect(kept.conflicts).toEqual({ b: null });
  });

  it('keeps the outputs this session’s kernel gave a cell the file changed', () => {
    const ran = notebook(
      cell('a', 'load()', [{ output_type: 'stream', name: 'stdout', text: 'mine' }]),
      cell('b', 'fit()'),
      cell('c', 'plot()')
    );
    const theirs = notebook(cell('a', 'load("clean")'), cell('b', 'fit()'), cell('c', 'plot()'));

    const merged = mergeFromDisk(base, ran, theirs, null)!;

    expect(merged.notebook.cells[0].source).toBe('load("clean")');
    expect(merged.notebook.cells[0].outputs).toEqual(ran.cells[0].outputs);
  });

  it('takes outputs the file gained for a cell this session did not run', () => {
    const output = { output_type: 'stream', name: 'stdout', text: 'from an agent' };
    const theirs = notebook(cell('a', 'load()', [output]), cell('b', 'fit()'), cell('c', 'plot()'));

    expect(mergeFromDisk(base, base, theirs, null)!.notebook.cells[0].outputs).toEqual([output]);
  });

  describe('the cell holding the cursor', () => {
    const theirs = notebook(cell('a', 'load()'), cell('b', 'fit(folds=3)'), cell('c', 'plot()'));

    it('is held, not changed under the reader', () => {
      const merged = mergeFromDisk(base, base, theirs, 'b')!;

      expect(merged.notebook.cells[1].source).toBe('fit()');
      expect(merged.held.b.theirs.source).toBe('fit(folds=3)');
      expect(merged.conflicts).toEqual({});
    });

    it('takes the file’s version once the cursor has left it', () => {
      const first = mergeFromDisk(base, base, theirs, 'b')!;

      const later = mergeFromDisk(theirs, first.notebook, theirs, 'c', first.held)!;

      expect(later.notebook.cells[1].source).toBe('fit(folds=3)');
      expect(later.held).toEqual({});
    });

    it('is a conflict once the reader types in it', () => {
      const first = mergeFromDisk(base, base, theirs, 'b')!;
      const typed = {
        ...first.notebook,
        cells: first.notebook.cells.map((each) =>
          each.id === 'b' ? { ...each, source: 'fit(folds=9)' } : each
        ),
      };

      const later = mergeFromDisk(theirs, typed, theirs, 'b', first.held)!;

      expect(later.notebook.cells[1].source).toBe('fit(folds=9)');
      expect(later.conflicts.b?.source).toBe('fit(folds=3)');
    });
  });

  it('takes the file’s notebook metadata unless the reader changed it', () => {
    const theirs = {
      ...base,
      metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' } },
    };

    expect(mergeFromDisk(base, base, theirs, null)!.notebook.metadata).toEqual(theirs.metadata);
  });

  it('cannot merge a notebook older than nbformat 4.5', () => {
    const old = { ...base, nbformat_minor: 4 };

    expect(mergeFromDisk(old, old, old, null)).toBeNull();
  });
});
