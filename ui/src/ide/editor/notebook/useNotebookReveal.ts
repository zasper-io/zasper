import { MutableRefObject, useEffect, useRef } from 'react';
import { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useAtomValue, useSetAtom } from 'jotai';

import { NotebookModel } from '@/api';
import { revealPositionAtom } from '@/store/languageServers';
import { MatchReveal, revealMatchAtom } from '@/store/projectSearch';
import { NotebookFind, outputText } from './useNotebookFind';

/**
 * The two ways another part of the window points into this notebook: a match pressed in the search
 * panel, and a problem pressed in the panel under the editor.
 */
export function useNotebookReveal(options: {
  path: string;
  notebook: NotebookModel;
  loading: boolean;
  editingCellId: string | null;
  focusCell: (cellId: string) => void;
  scrollTo: (cellId: string) => void;
  find: NotebookFind;
  finding: boolean;
  /** Opens the find card without taking the keyboard, which stays with the match it steps to. */
  openFindForReveal: () => void;
  cellViews: MutableRefObject<Map<string, EditorView>>;
  viewsVersion: number;
}) {
  const {
    path,
    notebook,
    loading,
    editingCellId,
    focusCell,
    scrollTo,
    find,
    finding,
    openFindForReveal,
    cellViews,
    viewsVersion,
  } = options;

  /**
   * A match pressed in the search panel: the notebook's card searching for the same thing, and that match
   * the current one. In two steps, because the card's matches only exist once its query has been set.
   */
  const reveal = useAtomValue(revealMatchAtom);
  const setReveal = useSetAtom(revealMatchAtom);
  const pendingReveal = useRef<MatchReveal | null>(null);
  const setFindOptions = useRef(find.setOptions);
  setFindOptions.current = find.setOptions;
  const findOptions = useRef(find.options);
  findOptions.current = find.options;
  useEffect(() => {
    if (reveal === null || reveal.path !== path || loading) {
      return;
    }
    setReveal(null);
    pendingReveal.current = reveal;
    const asked = findOptions.current;
    // Set only when different: an unchanged search set again is a new query, whose reset would take away
    // the current match a moment after the step below has made it.
    if (
      asked.search !== reveal.search ||
      asked.caseSensitive !== reveal.caseSensitive ||
      asked.wholeWord !== reveal.wholeWord ||
      asked.regexp !== reveal.regexp ||
      !asked.outputs
    ) {
      setFindOptions.current({
        search: reveal.search,
        caseSensitive: reveal.caseSensitive,
        wholeWord: reveal.wholeWord,
        regexp: reveal.regexp,
        outputs: true,
      });
    }
    openFindForReveal();
  }, [reveal, path, loading, setReveal, openFindForReveal]);

  useEffect(() => {
    const wanted = pendingReveal.current;
    const asked = find.options;
    // After the card is open, for the same reason: opening it resets the current match too.
    if (
      wanted === null ||
      !finding ||
      asked.search !== wanted.search ||
      asked.caseSensitive !== wanted.caseSensitive ||
      asked.wholeWord !== wanted.wholeWord ||
      asked.regexp !== wanted.regexp
    ) {
      return;
    }
    const index = wanted.cell ?? -1;
    const cell = notebook.cells[index];
    if (cell === undefined) {
      pendingReveal.current = null;
      return;
    }
    // A cell's editor arrives a render after the cell does. A markdown cell showing its prose never has
    // one, and is the only cell not worth waiting for.
    const rendered = cell.cell_type === 'markdown' && editingCellId !== cell.id;
    if (!rendered && wanted.output !== true && !cellViews.current.has(cell.id)) {
      return;
    }
    pendingReveal.current = null;
    const text = wanted.output === true ? outputText(cell) : cell.source;
    const doc = Text.of(text.split('\n'));
    const from = doc.line(Math.min(wanted.line, doc.lines)).from + wanted.from;
    const where = wanted.output === true ? 'output' : 'source';
    const found = find.matches.findIndex(
      (match) => match.cellId === cell.id && match.where === where && match.from === from
    );
    if (found >= 0) {
      find.goTo(found);
      return;
    }
    // Not among the card's matches — a rendered markdown cell, which the card does not search — so the
    // cell itself is where the reader is taken.
    focusCell(cell.id);
    scrollTo(cell.id);
  }, [find, finding, notebook.cells, focusCell, scrollTo, editingCellId, cellViews, viewsVersion]);

  // A problem pressed in the panel under the editor: its cell focused, with the cursor where it is.
  const revealPosition = useAtomValue(revealPositionAtom);
  const setRevealPosition = useSetAtom(revealPositionAtom);
  useEffect(() => {
    if (revealPosition === null || revealPosition.path !== path || loading) {
      return;
    }
    const cell = notebook.cells[revealPosition.cell ?? -1];
    const view = cell && cellViews.current.get(cell.id);
    if (view === undefined) {
      return;
    }
    setRevealPosition(null);
    focusCell(cell.id);
    scrollTo(cell.id);
    const doc = view.state.doc;
    const line = doc.line(Math.min(revealPosition.line + 1, doc.lines));
    view.dispatch({
      selection: { anchor: Math.min(line.from + revealPosition.character, line.to) },
    });
    view.focus();
  }, [
    revealPosition,
    path,
    loading,
    notebook.cells,
    focusCell,
    scrollTo,
    setRevealPosition,
    cellViews,
    viewsVersion,
  ]);
}
