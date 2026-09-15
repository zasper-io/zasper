import { SearchQuery } from '@codemirror/search';
import { Text } from '@codemirror/state';

/** The name the stylesheet paints: see `::highlight(zasper-find)` in NotebookFindCard.scss. */
const HIGHLIGHT = 'zasper-find';

/**
 * Marks a query's matches inside a notebook's outputs.
 *
 * Not decorations, because an output is not an editor: it is React's HTML, and a traceback is ANSI
 * turned into spans. Rather than rewrite the output renderer to wrap matches — which would mean
 * parsing that HTML — this paints them with the CSS Custom Highlight API, which takes plain Ranges
 * over the text as it stands and leaves the DOM alone.
 *
 * Where the browser has no such registry, outputs are searched and counted but not marked: the card
 * still says how many matches are in an output, so the count never lies about what was found.
 */
export function markOutputs(root: HTMLElement | null, query: SearchQuery | null): void {
  const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  if (highlights === undefined || typeof Highlight === 'undefined') {
    return;
  }
  if (root === null || query === null || !query.valid) {
    highlights.delete(HIGHLIGHT);
    return;
  }

  const ranges: Range[] = [];
  root.querySelectorAll('.inner-text').forEach((output) => {
    const walker = document.createTreeWalker(output, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      if (text === '') {
        continue;
      }
      // The same cursor the count uses, so what is painted and what is counted cannot disagree.
      const cursor = query.getCursor(Text.of(text.split('\n')));
      for (let next = cursor.next(); !next.done; next = cursor.next()) {
        const range = document.createRange();
        range.setStart(node, next.value.from);
        range.setEnd(node, next.value.to);
        ranges.push(range);
      }
    }
  });

  if (ranges.length === 0) {
    highlights.delete(HIGHLIGHT);
    return;
  }
  highlights.set(HIGHLIGHT, new Highlight(...ranges));
}
