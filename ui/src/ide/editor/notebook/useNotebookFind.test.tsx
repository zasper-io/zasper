/*
 * Find and replace across a notebook (story 17).
 *
 * The cases that matter are the ones a single document cannot have: a match in the third cell, a cell
 * whose prose is rendered and so is not searched at all, and a match in something the kernel printed,
 * which can be counted and stepped to but never written to.
 */
import { act, renderHook } from '@testing-library/react';
import { SearchQuery } from '@codemirror/search';
import { EditorState, TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

import { NotebookCell } from '@/api';
import { outputText, replacementFor, useNotebookFind } from './useNotebookFind';

/** Enough of an EditorView for the hook: a document it can read, edit and select in. */
function fakeView(doc: string) {
  let state = EditorState.create({ doc });
  return {
    get state() {
      return state;
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state;
    },
    focus: () => {},
  } as unknown as EditorView;
}

function cell(id: string, source: string, over: Partial<NotebookCell> = {}): NotebookCell {
  return { cell_type: 'code', id, source, metadata: {}, reload: false, ...over };
}

const notebook = [
  cell('a', 'frame = read()'),
  cell('b', 'frame = frame.dropna()\nframe.head()'),
  cell('c', 'print(total)', {
    outputs: [{ output_type: 'stream', name: 'stdout', text: 'frame total: 20160\n' }],
  }),
];

/** The hook over `cells`, with an editor for every cell that has one. */
function find(cells: NotebookCell[] = notebook, withoutViews: string[] = []) {
  const views = { current: new Map<string, EditorView>() };
  cells.forEach((each) => {
    if (!withoutViews.includes(each.id)) {
      views.current.set(each.id, fakeView(each.source));
    }
  });
  const focusCell = vi.fn();
  const scrollTo = vi.fn();
  const rendered = renderHook(() =>
    useNotebookFind({ cells, views, focusCell, scrollTo, active: true })
  );
  return { ...rendered, views, focusCell };
}

describe('useNotebookFind', () => {
  it('counts every cell, in the order they are read in', () => {
    const { result } = find();

    act(() => result.current.setOptions({ search: 'frame' }));

    // One in the first cell, three in the second, one in the third cell's output.
    expect(result.current.matches.map((match) => match.cellId)).toEqual(['a', 'b', 'b', 'b', 'c']);
    expect(result.current.matches.at(-1)?.where).toBe('output');
    expect(result.current.inOutputs).toBe(1);
  });

  // What the search panel uses to open a notebook at the match that was pressed.
  it('makes a match chosen from outside the current one, and shows it', () => {
    const { result, views, focusCell } = find();
    act(() => result.current.setOptions({ search: 'frame' }));

    act(() => result.current.goTo(2));

    expect(result.current.current).toBe(3);
    expect(focusCell).toHaveBeenCalledWith('b');
    expect(views.current.get('b')?.state.selection.main.from).toBe(8);
  });

  it('leaves outputs out when it is asked to', () => {
    const { result } = find();

    act(() => result.current.setOptions({ search: 'frame', outputs: false }));

    expect(result.current.matches).toHaveLength(4);
    expect(result.current.inOutputs).toBe(0);
  });

  // Story 17: a rendered markdown cell is not searched, and the count says so.
  it('does not search a rendered markdown cell, and says how many it skipped', () => {
    const cells = [...notebook, cell('d', '# frame notes', { cell_type: 'markdown' })];
    const { result } = find(cells, ['d']);

    act(() => result.current.setOptions({ search: 'frame' }));

    expect(result.current.matches.map((match) => match.cellId)).not.toContain('d');
    expect(result.current.skippedRendered).toBe(1);
  });

  it('searches a markdown cell that is open, like any other', () => {
    const cells = [...notebook, cell('d', '# frame notes', { cell_type: 'markdown' })];
    const { result } = find(cells);

    act(() => result.current.setOptions({ search: 'frame' }));

    expect(result.current.matches.map((match) => match.cellId)).toContain('d');
    expect(result.current.skippedRendered).toBe(0);
  });

  it('steps through the matches, selecting the one in its own cell', () => {
    const { result, views, focusCell } = find();
    act(() => result.current.setOptions({ search: 'frame' }));

    act(() => result.current.next());
    expect(result.current.current).toBe(1);
    expect(focusCell).toHaveBeenLastCalledWith('a');
    expect(views.current.get('a')?.state.selection.main.from).toBe(0);

    act(() => result.current.next());
    expect(result.current.current).toBe(2);
    expect(focusCell).toHaveBeenLastCalledWith('b');

    // Back past the first match, round to the last — which is the one in an output.
    act(() => result.current.previous());
    act(() => result.current.previous());
    expect(result.current.current).toBe(5);
    expect(result.current.matches[4].where).toBe('output');
  });

  it('replaces the match it is on, in that cell alone', () => {
    const { result, views } = find();
    act(() => result.current.setOptions({ search: 'frame', replace: 'table' }));
    act(() => result.current.next());

    act(() => result.current.replaceCurrent());

    expect(views.current.get('a')?.state.doc.toString()).toBe('table = read()');
    expect(views.current.get('b')?.state.doc.toString()).toBe(
      'frame = frame.dropna()\nframe.head()'
    );
  });

  it('replaces every match in every cell, and never one in an output', () => {
    const { result, views } = find();
    act(() => result.current.setOptions({ search: 'frame', replace: 'table' }));

    act(() => result.current.replaceAll());

    expect(views.current.get('a')?.state.doc.toString()).toBe('table = read()');
    expect(views.current.get('b')?.state.doc.toString()).toBe(
      'table = table.dropna()\ntable.head()'
    );
    // The printed line is the kernel's, and is left exactly as it was.
    expect(outputText(notebook[2])).toContain('frame total');
    // Nothing is left selected, so nothing looks as though it is still a match.
    expect(views.current.get('b')?.state.selection.main.empty).toBe(true);
  });

  it('says when a pattern cannot be read, rather than saying there are no matches', () => {
    const { result } = find();

    act(() => result.current.setOptions({ search: '(', regexp: true }));

    expect(result.current.broken).toBe(true);
    expect(result.current.matches).toEqual([]);
  });
});

describe('outputText', () => {
  it('reads a stream, plain text and a traceback', () => {
    const printed = outputText(
      cell('x', '', {
        outputs: [
          { output_type: 'stream', text: 'one\n' },
          { output_type: 'execute_result', data: { 'text/plain': 'two' } },
          { output_type: 'error', ename: 'ValueError', evalue: 'three', traceback: ['four'] },
        ],
      })
    );

    expect(printed).toContain('one');
    expect(printed).toContain('two');
    expect(printed).toContain('ValueError: three');
    expect(printed).toContain('four');
  });
});

describe('replacementFor', () => {
  it('writes the replacement as typed', () => {
    const query = new SearchQuery({ search: 'frame', replace: 'table' });

    expect(replacementFor(query, 'frame')).toBe('table');
  });

  // CodeMirror expands these inside its own commands, which a notebook's replace cannot use.
  it('stands $& and $1 in for what the pattern captured', () => {
    const query = new SearchQuery({
      search: 'frame_(\\w+)',
      replace: 'table_$1 /* was $& */',
      regexp: true,
    });

    expect(replacementFor(query, 'frame_one')).toBe('table_one /* was frame_one */');
  });
});
