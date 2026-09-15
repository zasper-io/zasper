import { getSearchQuery, SearchQuery } from '@codemirror/search';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
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
 * `Decoration.none` unless its own panel is open, and story 15 settled that the panel is ours and is
 * not one of CodeMirror's. This is that highlighter again, over the query the library still holds, with
 * the same two class names — so `.cm-searchMatch` in styles/_codemirror.scss paints both.
 *
 * Only the visible ranges, as theirs does: a match a thousand lines down has nothing to mark yet.
 */
export const findHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = marks(view);
    }

    update(update: ViewUpdate) {
      const asked = !getSearchQuery(update.startState).eq(getSearchQuery(update.state));
      if (asked || update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = marks(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

function marks(view: EditorView): DecorationSet {
  const query = getSearchQuery(view.state);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    for (const match of matchRanges(view.state, query, range.from, range.to)) {
      builder.add(match.from, match.to, match.current ? currentMark : matchMark);
    }
  }
  return builder.finish();
}
