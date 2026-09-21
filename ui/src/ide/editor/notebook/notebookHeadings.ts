import { NotebookModel } from '@/api';

/**
 * A heading a notebook's table of contents lists, and the cell it will scroll to.
 *
 * Read off the *source* of every markdown cell rather than out of what `MarkdownRenderer` drew:
 * react-markdown emits bare `<h1>`–`<h6>` with no `id`, so the rendered document has nothing to point
 * at, and a cell that is open for editing has no rendered form at all. Reading the source instead
 * means a heading has a row from the first `#` typed.
 */
export interface NotebookHeading {
  /** Where the cell is in `notebook.cells`: what a click scrolls to and focuses. */
  cellIndex: number;
  cellId: string;
  /** 1 to 6, as the `#` count. */
  level: number;
  /** The heading's own text, with the markers taken out. */
  text: string;
  /** Which line of the cell it is on, so two headings in one cell are told apart. */
  line: number;
}

/** Stable across renders and unique: a cell can hold more than one heading. */
export function headingKey(heading: NotebookHeading): string {
  return `${heading.cellId}:${heading.line}`;
}

const ATX = /^ {0,3}(#{1,6})(\s+.*)?$/;
const FENCE = /^ {0,3}(```+|~~~+)/;

/**
 * The inline markers a heading's text carries, taken out so the row reads as words: emphasis, code
 * ticks, and a link's target. Not a markdown parser — a table of contents shows `**Setup**` as
 * "Setup" and stops there.
 */
function plainText(source: string): string {
  return source
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim();
}

/**
 * Every ATX heading in a markdown cell, in order.
 *
 * Setext headings (a line underlined with `===`) are deliberately not read: `---` under a line is
 * also a thematic break and the row above a table, and guessing wrong puts a row in the table that
 * the reader cannot see in their notebook. Fenced blocks are skipped, so a `# comment` in a Python
 * block inside a markdown cell is not mistaken for a heading.
 */
function headingsInSource(source: string): { level: number; text: string; line: number }[] {
  const headings: { level: number; text: string; line: number }[] = [];
  let fence: string | null = null;

  source.split('\n').forEach((line, index) => {
    if (fence !== null) {
      if (line.trimStart().startsWith(fence)) {
        fence = null;
      }
      return;
    }
    const opening = FENCE.exec(line);
    if (opening) {
      fence = opening[1].slice(0, 3);
      return;
    }
    const match = ATX.exec(line);
    if (match) {
      // A closing run of `#`s is markdown's, not the author's title.
      const text = plainText((match[2] ?? '').replace(/\s+#+\s*$/, ''));
      if (text !== '') {
        headings.push({ level: match[1].length, text, line: index });
      }
    }
  });

  return headings;
}

/** Every heading in the notebook, in document order. */
export function notebookHeadings(notebook: NotebookModel): NotebookHeading[] {
  return notebook.cells.flatMap((cell, cellIndex) =>
    cell.cell_type !== 'markdown'
      ? []
      : headingsInSource(cell.source).map((heading) => ({
          ...heading,
          cellIndex,
          cellId: cell.id,
        }))
  );
}

/**
 * The section a cell is in: the last heading at or before it, which is the row the table marks as
 * where you are. -1 when the cell sits above every heading, which is where most notebooks start.
 */
export function sectionOfCell(headings: NotebookHeading[], cellIndex: number): number {
  let section = -1;
  headings.forEach((heading, index) => {
    if (heading.cellIndex <= cellIndex) {
      section = index;
    }
  });
  return section;
}
