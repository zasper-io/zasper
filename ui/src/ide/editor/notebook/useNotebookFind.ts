import { RefObject, useCallback, useEffect, useMemo, useState } from 'react';

import { SearchQuery, setSearchQuery } from '@codemirror/search';
import { ChangeSpec, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { NotebookCell, NotebookOutput } from '@/api';
import { setCurrentMatch } from '../findHighlight';
import { findQuery } from '../findMatches';

/** What the notebook's card is asking for. Outputs are searched by default. */
export interface NotebookFindOptions {
  search: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  outputs: boolean;
}

export const NO_FIND: NotebookFindOptions = {
  search: '',
  replace: '',
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  outputs: true,
};

export interface NotebookMatch {
  cellId: string;
  /** Where the cell is in the notebook, for scrolling to it. */
  index: number;
  /** A cell's source can be replaced; what the kernel printed cannot. */
  where: 'source' | 'output';
  from: number;
  to: number;
}

export interface NotebookFind {
  options: NotebookFindOptions;
  /** What is being looked for, or null for a query the library cannot run: see `markOutputs`. */
  query: SearchQuery | null;
  setOptions: (change: Partial<NotebookFindOptions>) => void;
  matches: NotebookMatch[];
  /** Which match the reader is on, from 1; 0 before the first step and when there are none. */
  current: number;
  /** Matches in an output, which the card says cannot be replaced. */
  inOutputs: number;
  /** Rendered markdown cells, which are not searched. */
  skippedRendered: number;
  /** True while the query is a regular expression that does not parse. */
  broken: boolean;
  next: () => void;
  previous: () => void;
  /** Makes the match at `index` in `matches` the current one, and shows it. */
  goTo: (index: number) => void;
  replaceCurrent: () => void;
  replaceAll: () => void;
}

/** A cell's outputs as the text a search can look through: a stream, plain text, and a traceback. */
export function outputText(cell: NotebookCell): string {
  return (cell.outputs ?? [])
    .map((output: NotebookOutput) => {
      const plain = output.data?.['text/plain'] ?? output['text/plain'];
      return [
        output.text,
        typeof plain === 'string' ? plain : Array.isArray(plain) ? plain.join('') : undefined,
        output.ename === undefined ? undefined : `${output.ename}: ${output.evalue ?? ''}`,
        output.traceback?.join('\n'),
      ]
        .filter((part): part is string => typeof part === 'string')
        .join('\n');
    })
    .join('\n');
}

/**
 * What a replacement writes, with `$&` and `$1`–`$9` standing for what a regular expression captured.
 *
 * CodeMirror expands these inside its own replace commands and does not export the expansion, and a
 * notebook's replace cannot go through those commands: they act on one view, and the match may be in
 * any of fifty.
 */
export function replacementFor(query: SearchQuery, matched: string): string {
  if (!query.regexp) {
    return query.replace;
  }
  const groups = new RegExp(query.search, query.caseSensitive ? '' : 'i').exec(matched);
  return query.replace.replace(/\$([&\d])/g, (whole, token: string) => {
    if (token === '&') {
      return matched;
    }
    return groups?.[Number(token)] ?? whole;
  });
}

interface NotebookFindInput {
  cells: NotebookCell[];
  /** Every mounted cell editor, by cell id: a rendered markdown cell has none. */
  views: RefObject<Map<string, EditorView>>;
  focusCell: (cellId: string) => void;
  /** Brings a cell's box into view, for a match in its output. */
  scrollTo: (cellId: string) => void;
  /** Whether the card is up. Nothing is marked while it is not, or matches would stay behind it. */
  active: boolean;
  /** Bumped when a cell's editor arrives, which is a render after the cell itself mounts. */
  viewsVersion?: number;
}

/**
 * Find and replace across a notebook.
 *
 * A notebook is not a document: it is fifty of them, some rendered rather than editable and some
 * printed by a kernel and not editable at all. So the query lives here rather than in a view, the
 * matches are counted over the cells' own source, and the library's search is used for one thing only
 * — marking what it is told to look for, one cell at a time.
 */
export function useNotebookFind({
  cells,
  views,
  focusCell,
  scrollTo,
  active,
  viewsVersion = 0,
}: NotebookFindInput): NotebookFind {
  const [options, setAll] = useState<NotebookFindOptions>(NO_FIND);
  const [at, setAt] = useState(0);

  const query = useMemo(() => findQuery(options), [options]);

  const mark = useCallback(
    (wanted: SearchQuery | null) => {
      const effect = setSearchQuery.of(wanted ?? new SearchQuery({ search: '' }));
      views.current?.forEach((view) => view.dispatch({ effects: effect }));
    },
    [views]
  );

  /**
   * What every cell is told to look for: when the query changes, when the card opens or closes, and when
   * a cell's editor arrives — an editor made after the query was set would otherwise have no marks.
   */
  useEffect(() => {
    mark(active ? query : null);
  }, [mark, active, query, cells.length, views, viewsVersion]);

  // A new query is a new list, so no match is the current one until the reader steps to it. Not on an
  // editor arriving, which would take the current match away from a step made just before it.
  useEffect(() => {
    views.current?.forEach((view) => view.dispatch({ effects: setCurrentMatch.of(null) }));
  }, [active, query, views]);

  const found = useMemo(() => {
    const matches: NotebookMatch[] = [];
    let inOutputs = 0;
    let skippedRendered = 0;

    cells.forEach((cell, index) => {
      // A markdown cell showing its prose has no editor, so it is left alone.
      if (cell.cell_type === 'markdown' && views.current?.get(cell.id) === undefined) {
        skippedRendered += 1;
        return;
      }
      if (query !== null) {
        const source = Text.of(cell.source.split('\n'));
        const cursor = query.getCursor(source);
        for (let next = cursor.next(); !next.done; next = cursor.next()) {
          matches.push({
            cellId: cell.id,
            index,
            where: 'source',
            from: next.value.from,
            to: next.value.to,
          });
        }
      }
    });

    if (query !== null && options.outputs) {
      cells.forEach((cell, index) => {
        const printed = outputText(cell);
        if (printed === '') {
          return;
        }
        const cursor = query.getCursor(Text.of(printed.split('\n')));
        for (let next = cursor.next(); !next.done; next = cursor.next()) {
          matches.push({
            cellId: cell.id,
            index,
            where: 'output',
            from: next.value.from,
            to: next.value.to,
          });
          inOutputs += 1;
        }
      });
    }

    // In the order they are read in: cell by cell, and within a cell the source before what it printed.
    matches.sort(
      (left, right) =>
        left.index - right.index ||
        (left.where === right.where ? left.from - right.from : left.where === 'source' ? -1 : 1)
    );
    return { matches, inOutputs, skippedRendered };
  }, [cells, query, options.outputs, views]);

  /**
   * Shows the match at `index`, and says that it is the current one.
   *
   * Said to every cell, not only the one holding it: a cell keeps its own cursor, and left to work out
   * "the match the selection is on" for itself each of them would claim the current match at once.
   */
  const reveal = useCallback(
    (index: number) => {
      const match = found.matches[index];
      views.current?.forEach((view, cellId) => {
        const mine =
          match !== undefined && match.where === 'source' && match.cellId === cellId
            ? { from: match.from, to: match.to }
            : null;
        view.dispatch({ effects: setCurrentMatch.of(mine) });
      });
      if (match === undefined) {
        return;
      }
      if (match.where === 'source') {
        const view = views.current?.get(match.cellId);
        focusCell(match.cellId);
        view?.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
        view?.focus();
        return;
      }
      // An output cannot hold a selection, so the cell it belongs to is scrolled to instead.
      scrollTo(match.cellId);
    },
    [found.matches, views, focusCell, scrollTo]
  );

  const step = useCallback(
    (by: number) => {
      if (found.matches.length === 0) {
        return;
      }
      // `at` counts from 1, so that "0" can mean "nothing stepped to yet".
      const next = ((at + by - 1 + found.matches.length) % found.matches.length) + 1;
      setAt(next);
      reveal(next - 1);
    },
    [at, found.matches.length, reveal]
  );

  const replaceCurrent = useCallback(() => {
    const match = found.matches[at - 1];
    if (query === null || match === undefined || match.where === 'output') {
      return;
    }
    const view = views.current?.get(match.cellId);
    if (view === undefined) {
      return;
    }
    const matched = view.state.sliceDoc(match.from, match.to);
    view.dispatch({
      changes: { from: match.from, to: match.to, insert: replacementFor(query, matched) },
      // Where the match was, so the next step carries on from here rather than from the top.
      selection: { anchor: match.from },
    });
  }, [found.matches, at, query, views]);

  const replaceAll = useCallback(() => {
    if (query === null) {
      return;
    }
    // One transaction per cell, so each cell's own undo takes its replacements back in one press.
    const byCell = new Map<string, ChangeSpec[]>();
    found.matches.forEach((match) => {
      if (match.where === 'output') {
        return;
      }
      const view = views.current?.get(match.cellId);
      if (view === undefined) {
        return;
      }
      const matched = view.state.sliceDoc(match.from, match.to);
      const changes = byCell.get(match.cellId) ?? [];
      changes.push({
        from: match.from,
        to: match.to,
        insert: replacementFor(query, matched),
      });
      byCell.set(match.cellId, changes);
    });

    byCell.forEach((changes, cellId) => {
      const view = views.current?.get(cellId);
      if (view === undefined) {
        return;
      }
      // The selection collapses to the cursor as well: left covering the replaced word, a cell's own
      // selection-match highlighting marks every copy of it, which reads as a search still running.
      view.dispatch({ changes });
      view.dispatch({
        selection: { anchor: view.state.selection.main.head },
        effects: setCurrentMatch.of(null),
      });
    });
    setAt(0);
  }, [found.matches, query, views]);

  return {
    options,
    query,
    setOptions: (change) => {
      setAll((current) => ({ ...current, ...change }));
      // A changed query is a changed list, so the step counter starts again.
      if (change.search !== undefined || change.outputs !== undefined) {
        setAt(0);
      }
    },
    matches: found.matches,
    current: Math.min(at, found.matches.length),
    inOutputs: found.inOutputs,
    skippedRendered: found.skippedRendered,
    broken: options.search !== '' && query === null,
    next: () => step(1),
    previous: () => step(-1),
    goTo: (index: number) => {
      if (index < 0 || index >= found.matches.length) {
        return;
      }
      setAt(index + 1);
      reveal(index);
    },
    replaceCurrent,
    replaceAll,
  };
}
