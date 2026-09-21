import { getSearchQuery, SearchQuery } from '@codemirror/search';
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

const matchMark = Decoration.mark({ class: 'cm-searchMatch' });
const currentMark = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' });

/** Where the matches are in one range of the document, and which of them the selection is on. */
export function matchRanges(
  state: EditorState,
  query: SearchQuery,
  from: number,
  to: number
): { from: number; to: number; current: boolean }[] {
  if (!query.valid) {
    return [];
  }
  const found: { from: number; to: number; current: boolean }[] = [];
  const cursor = query.getCursor(state, from, to);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    const match = next.value;
    found.push({
      from: match.from,
      to: match.to,
      // The one a step landed on, which is the selection: it wears the second mark.
      current: state.selection.ranges.some(
        (range) => range.from === match.from && range.to === match.to
      ),
    });
  }
  return found;
}

/**
 * Marks every match that is on screen.
 *
 * @codemirror/search has a highlighter of its own and it draws nothing here: it returns
 * `Decoration.none` unless its own panel is open, and the panel is ours and is
 * not one of CodeMirror's. This is that highlighter again, over the query the library still holds, with
 * the same two class names — so `.cm-searchMatch` in styles/_codemirror.scss paints both.
 *
 * Only the visible ranges, as theirs does: a match a thousand lines down has nothing to mark yet.
 */
function highlighter(currentFromSelection: boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = marks(view, currentFromSelection);
      }

      update(update: ViewUpdate) {
        const asked = !getSearchQuery(update.startState).eq(getSearchQuery(update.state));
        if (asked || update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = marks(update.view, currentFromSelection);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}

/** The file editor's: one document, so the match the selection is on is the one the reader is on. */
export const findHighlighter = highlighter(true);

/**
 * A notebook cell's: every match marked, and none of them the current one.
 *
 * A notebook is fifty documents and fifty cursors, so "the match the selection is on" is true in
 * several cells at once — which is how three matches came to be marked as current together. Which one
 * the reader is on is the notebook's to say, through `currentMatchField`.
 */
export const cellFindHighlighter = highlighter(false);

function marks(view: EditorView, currentFromSelection: boolean): DecorationSet {
  const query = getSearchQuery(view.state);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    for (const match of matchRanges(view.state, query, range.from, range.to)) {
      builder.add(
        match.from,
        match.to,
        currentFromSelection && match.current ? currentMark : matchMark
      );
    }
  }
  return builder.finish();
}

/** Says which range in this cell is the match the reader is on, or that none of them is. */
export const setCurrentMatch = StateEffect.define<{ from: number; to: number } | null>();

/**
 * The one match the reader is on, said by the notebook rather than worked out per cell.
 *
 * Kept as a field so it survives the cell being typed in — the ranges are mapped through the edit —
 * and so that clearing it is one effect rather than a re-render of every cell.
 */
export const currentMatchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marked, transaction) {
    let next = marked.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setCurrentMatch)) {
        next =
          effect.value === null
            ? Decoration.none
            : Decoration.set([currentMark.range(effect.value.from, effect.value.to)]);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
