import { ProtocolPosition } from './positions';

/** A code cell as the virtual document is built from it. */
export interface SourceCell {
  id: string;
  /** Where the cell is in the notebook, counting every kind of cell. */
  index: number;
  source: string;
}

/** Where one cell's lines are in the virtual document. */
export interface CellSpan {
  id: string;
  index: number;
  source: string;
  /** Its first line in the virtual document, from 0. */
  start: number;
  lines: number;
  /** Lines of the cell the server is not shown as written — magics, shell escapes, help — from 0. */
  hidden: ReadonlySet<number>;
  /** The cell's last line with anything on it, from 0: the line a notebook shows the value of. */
  last: number;
}

export interface VirtualDocument {
  text: string;
  cells: CellSpan[];
}

/** Two blank lines between cells, so a formatter's or linter's spacing rules see what a module has. */
const GAP = 2;

/**
 * Cell magics whose body is Python, so only the magic line is hidden. Any other cell magic — `%%bash`,
 * `%%html` — makes the whole cell something else.
 */
const PYTHON_CELL_MAGICS = new Set(['time', 'timeit', 'capture', 'prun', 'debug']);

const ASSIGNED_MAGIC = /^(\s*[A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*\s*=)\s*[!%]/;
const HELP = /^\s*(?:\?{1,2}[\w.]+|[\w.[\]()'"]+\?{1,2})\s*$/;

/** How much a line opens brackets by, ignoring strings and comments on it. */
function bracketDepthChange(line: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let at = 0; at < line.length; at++) {
    const char = line[at];
    if (quote !== null) {
      if (char === '\\') {
        at++;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === '#') {
      break;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if ('([{'.includes(char)) {
      depth++;
    } else if (')]}'.includes(char)) {
      depth--;
    }
  }
  return depth;
}

/**
 * A cell's source as a language server can read it: IPython's syntax that is not Python replaced, line for
 * line, so every line keeps its number and every visible line its columns. A hidden line becomes `pass` at
 * its indent — valid wherever a statement is — or keeps the names it assigns, so `files = !ls` still
 * defines `files`, as a value of unknown type. A formatter is given `placeholder` instead, a comment it will leave alone and that can be
 * found again afterwards.
 */
export function maskIPython(
  source: string,
  placeholder?: (line: number) => string
): { text: string; hidden: Set<number> } {
  const lines = source.split('\n');
  const hidden = new Set<number>();

  const cellMagic = /^%%(\w+)/.exec(lines[0] ?? '');
  if (cellMagic !== null) {
    if (!PYTHON_CELL_MAGICS.has(cellMagic[1])) {
      return { text: lines.map(() => '').join('\n'), hidden: new Set(lines.keys()) };
    }
    hidden.add(0);
    lines[0] = placeholder?.(0) ?? '';
  }

  let depth = 0;
  let continued = false;
  const masked = lines.map((line, number) => {
    const atStatement = depth <= 0 && !continued;
    depth += bracketDepthChange(line);
    continued = /\\\s*$/.test(line);
    if (!atStatement || hidden.has(number)) {
      return line;
    }
    const indent = /^\s*/.exec(line)?.[0] ?? '';
    const rest = line.slice(indent.length);
    const assigned = ASSIGNED_MAGIC.exec(line);
    if (rest.startsWith('%') || rest.startsWith('!') || HELP.test(line) || assigned !== null) {
      hidden.add(number);
      depth = 0;
      if (placeholder !== undefined) {
        return `${indent}${placeholder(number)}`;
      }
      // `eval` is typed to return Any, which is as much as anyone knows about what a magic returns.
      return assigned === null ? `${indent}pass` : `${assigned[1]} eval("")`;
    }
    return line;
  });
  return { text: masked.join('\n'), hidden };
}

function lastWrittenLine(source: string): number {
  const lines = source.split('\n');
  for (let line = lines.length - 1; line >= 0; line--) {
    if (lines[line].trim() !== '') {
      return line;
    }
  }
  return 0;
}

/** The code cells joined into one document a language server can be given, and where each cell went. */
export function buildVirtualDocument(cells: SourceCell[], ipython: boolean): VirtualDocument {
  const spans: CellSpan[] = [];
  const parts: string[] = [];
  let start = 0;
  cells.forEach((cell) => {
    const masked = ipython
      ? maskIPython(cell.source)
      : { text: cell.source, hidden: new Set<number>() };
    const lines = masked.text.split('\n').length;
    spans.push({
      id: cell.id,
      index: cell.index,
      source: cell.source,
      start,
      lines,
      hidden: masked.hidden,
      last: lastWrittenLine(cell.source),
    });
    parts.push(masked.text);
    start += lines + GAP;
  });
  return { text: `${parts.join('\n'.repeat(GAP + 1))}\n`, cells: spans };
}

/** A position in a cell as the virtual document counts it, or null for a cell it does not hold. */
export function toVirtual(
  doc: VirtualDocument,
  cellId: string,
  position: ProtocolPosition
): ProtocolPosition | null {
  const span = doc.cells.find((cell) => cell.id === cellId);
  if (span === undefined) {
    return null;
  }
  return {
    line: span.start + Math.min(position.line, span.lines - 1),
    character: position.character,
  };
}

export interface CellPosition extends ProtocolPosition {
  cell: CellSpan;
}

/**
 * The cell a virtual position is in, with the position inside it. Null for the lines between cells and for
 * a line the server was not shown as written: whatever it says there is about text the reader never wrote.
 */
export function fromVirtual(doc: VirtualDocument, position: ProtocolPosition): CellPosition | null {
  const span = doc.cells.find(
    (cell) => position.line >= cell.start && position.line < cell.start + cell.lines
  );
  if (span === undefined) {
    return null;
  }
  const line = position.line - span.start;
  if (span.hidden.has(line)) {
    return null;
  }
  return { cell: span, line, character: position.character };
}
