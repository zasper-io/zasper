import { diff as charDiff } from '@codemirror/merge';

import { NotebookOutput, TABLE_MIME } from '@/api';

/** One cell as the server reads it from either side of a comparison. */
export interface DiffCell {
  id?: string;
  cell_type: string;
  source: string;
  outputs?: NotebookOutput[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
}

export interface NotebookSide {
  cells: DiffCell[];
  metadata: Record<string, unknown> | null;
  nbformat_minor: number;
}

export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  oldNumber?: number;
  newNumber?: number;
  text: string;
  /** The characters that changed inside a changed line, as [from, to) ranges. */
  marks?: [number, number][];
}

export type CellChange = 'unchanged' | 'edited' | 'added' | 'removed' | 'moved' | 'outputs';

export interface CellDiff {
  change: CellChange;
  old?: { index: number; cell: DiffCell };
  new?: { index: number; cell: DiffCell };
  moved: boolean;
  sourceChanged: boolean;
  outputsChanged: boolean;
  metadataChanged: boolean;
}

export interface NotebookDiff {
  /** Every cell of either side, in the order the reader meets them: the new side's, with each removed
   *  cell after the cell that came before it. */
  cells: CellDiff[];
  metadataChanged: boolean;
}

// Frontend bookkeeping a notebook app writes for itself, which no person edited.
const IGNORED_METADATA = ['collapsed', 'scrolled', 'execution', 'ExecuteTime'];
// Past this many lines on a side, a cell's source is shown as all removed and all added rather than
// aligned: the alignment is quadratic.
const MAX_ALIGNED_LINES = 3000;
const SIMILAR = 0.5;

/** JSON with its keys sorted, so two readings of the same value compare equal. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) {
      return inner;
    }
    const record = inner as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]])
    );
  });
}

/** A cell's metadata without what a frontend writes for itself. */
export function personalMetadata(cell: DiffCell): Record<string, unknown> {
  const metadata = { ...(cell.metadata ?? {}) };
  for (const key of IGNORED_METADATA) {
    delete metadata[key];
  }
  return metadata;
}

/**
 * A cell's outputs without what every run renumbers or reissues: an `execute_result`'s execution count,
 * and the id Zasper's own table entry gets each time a frame is displayed.
 */
export function comparableOutputs(cell: DiffCell): unknown[] {
  return (cell.outputs ?? []).map((output) => {
    const { execution_count: _count, ...rest } = output as NotebookOutput & {
      execution_count?: unknown;
    };
    if (rest.data && TABLE_MIME in rest.data) {
      const data = { ...rest.data };
      delete data[TABLE_MIME];
      return { ...rest, data };
    }
    return rest;
  });
}

function lines(text: string): string[] {
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  return trimmed === '' ? [] : trimmed.split('\n');
}

/** The pairs of a longest common subsequence of two lists, by index. */
function commonSubsequence<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): [number, number][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] = same(a[i], b[j])
        ? table[(i + 1) * cols + j + 1] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (same(a[i], b[j])) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

const WORD = /[\p{L}\p{N}_]/u;

/**
 * Character ranges widened to the words they fall in, and merged where they then touch: a reader looks
 * for `5min` against `1min`, not for one digit, and `median` against `mean` is one word, not three letters.
 */
function toWords(text: string, ranges: [number, number][]): [number, number][] {
  const widened = ranges.map(([from, to]): [number, number] => {
    let start = from;
    let end = to;
    while (start > 0 && WORD.test(text[start - 1]) && (start === to || WORD.test(text[start]))) {
      start--;
    }
    while (
      end < text.length &&
      WORD.test(text[end]) &&
      (end === from || WORD.test(text[end - 1]))
    ) {
      end++;
    }
    return [start, end];
  });
  const merged: [number, number][] = [];
  for (const range of widened.sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged.filter(([from, to]) => to > from);
}

/** The words that differ between two lines, for marking inside them. */
function changedRanges(before: string, after: string): [[number, number][], [number, number][]] {
  const changes = charDiff(before, after);
  const inBefore = changes.map((change): [number, number] => [change.fromA, change.toA]);
  const inAfter = changes.map((change): [number, number] => [change.fromB, change.toB]);
  return [toWords(before, inBefore), toWords(after, inAfter)];
}

/**
 * Two texts as one column of lines: the same, removed or added, with each side's line number. A removed
 * line followed by an added one is a changed line, and the words that changed inside it are marked.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  const pairs =
    a.length > MAX_ALIGNED_LINES || b.length > MAX_ALIGNED_LINES
      ? []
      : commonSubsequence(a, b, (x, y) => x === y);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  const flush = (untilA: number, untilB: number) => {
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    for (; i < untilA; i++) {
      removed.push({ kind: 'removed', oldNumber: i + 1, text: a[i] });
    }
    for (; j < untilB; j++) {
      added.push({ kind: 'added', newNumber: j + 1, text: b[j] });
    }
    for (let k = 0; k < Math.min(removed.length, added.length); k++) {
      [removed[k].marks, added[k].marks] = changedRanges(removed[k].text, added[k].text);
    }
    out.push(...removed, ...added);
  };
  for (const [x, y] of pairs) {
    flush(x, y);
    out.push({ kind: 'same', oldNumber: x + 1, newNumber: y + 1, text: a[x] });
    i = x + 1;
    j = y + 1;
  }
  flush(a.length, b.length);
  return out;
}

/** How alike two sources are, from 0 to 1: the share of their lines, or for one-liners their characters, in common. */
export function similarity(before: string, after: string): number {
  const a = lines(before);
  const b = lines(after);
  if (a.length + b.length === 0) {
    return 1;
  }
  if (a.length <= 1 && b.length <= 1) {
    const x = a[0] ?? '';
    const y = b[0] ?? '';
    const changed = charDiff(x, y).reduce(
      (sum, change) => sum + (change.toA - change.fromA) + (change.toB - change.fromB),
      0
    );
    return x.length + y.length === 0 ? 1 : 1 - changed / (x.length + y.length);
  }
  if (a.length > MAX_ALIGNED_LINES || b.length > MAX_ALIGNED_LINES) {
    return 0;
  }
  return (2 * commonSubsequence(a, b, (x, y) => x === y).length) / (a.length + b.length);
}

const sourceKey = (cell: DiffCell) => cell.source.replace(/\s+$/, '');

function hasIds(cells: DiffCell[]): boolean {
  const ids = cells.map((cell) => cell.id);
  return ids.every((id) => typeof id === 'string' && id !== '') && new Set(ids).size === ids.length;
}

/**
 * Which cell of one side is which of the other.
 *
 * By id where both sides carry them, which is nbformat 4.5's whole point: the same id is the same cell
 * wherever it went. Otherwise by source, as nbdime does: identical sources first, in order, then the
 * most alike of what is left between each two of those. A removed cell and an added one with the same
 * source are one cell that moved.
 */
export function matchCells(before: DiffCell[], after: DiffCell[]): [number, number][] {
  if (before.length > 0 && after.length > 0 && hasIds(before) && hasIds(after)) {
    const where = new Map(after.map((cell, index) => [cell.id, index]));
    return before
      .flatMap((cell, index) => {
        const other = where.get(cell.id);
        return other === undefined ? [] : [[index, other] as [number, number]];
      })
      .sort((x, y) => x[1] - y[1]);
  }

  const anchors = commonSubsequence(before, after, (x, y) => sourceKey(x) === sourceKey(y));
  const pairs: [number, number][] = [];
  const bounds: [number, number][] = [...anchors, [before.length, after.length]];
  let fromA = 0;
  let fromB = 0;
  for (const [toA, toB] of bounds) {
    let nextB = fromB;
    for (let i = fromA; i < toA; i++) {
      let best = -1;
      let bestScore = SIMILAR;
      for (let j = nextB; j < toB; j++) {
        if (before[i].cell_type !== after[j].cell_type) {
          continue;
        }
        const score = similarity(before[i].source, after[j].source);
        if (score >= bestScore) {
          best = j;
          bestScore = score;
        }
      }
      if (best >= 0) {
        pairs.push([i, best]);
        nextB = best + 1;
      }
    }
    if (toA < before.length) {
      pairs.push([toA, toB]);
    }
    fromA = toA + 1;
    fromB = toB + 1;
  }

  const pairedA = new Set(pairs.map(([a]) => a));
  const pairedB = new Set(pairs.map(([, b]) => b));
  for (let i = 0; i < before.length; i++) {
    if (pairedA.has(i)) {
      continue;
    }
    const twin = after.findIndex(
      (cell, j) =>
        !pairedB.has(j) && sourceKey(cell) === sourceKey(before[i]) && sourceKey(cell) !== ''
    );
    if (twin >= 0) {
      pairs.push([i, twin]);
      pairedA.add(i);
      pairedB.add(twin);
    }
  }
  return pairs.sort((x, y) => x[1] - y[1]);
}

/** The pairs that kept their order relative to each other; every other pair moved. */
function inPlace(pairs: [number, number][]): Set<number> {
  const byNew = [...pairs].sort((x, y) => x[1] - y[1]);
  const kept = commonSubsequence(
    byNew.map(([a]) => a),
    [...byNew.map(([a]) => a)].sort((x, y) => x - y),
    (x, y) => x === y
  );
  return new Set(kept.map(([index]) => byNew[index][0]));
}

/** The comparison of two notebooks, cell by cell. An absent side is an empty notebook. */
export function diffNotebooks(
  before: NotebookSide | null,
  after: NotebookSide | null
): NotebookDiff {
  const a = before?.cells ?? [];
  const b = after?.cells ?? [];
  const pairs = matchCells(a, b);
  const stayed = inPlace(pairs);
  const byOld = new Map(pairs.map(([x, y]) => [x, y]));

  const describe = (x: number | undefined, y: number | undefined): CellDiff => {
    if (x === undefined) {
      return {
        change: 'added',
        new: { index: y!, cell: b[y!] },
        moved: false,
        sourceChanged: true,
        outputsChanged: (b[y!].outputs ?? []).length > 0,
        metadataChanged: false,
      };
    }
    if (y === undefined) {
      return {
        change: 'removed',
        old: { index: x, cell: a[x] },
        moved: false,
        sourceChanged: true,
        outputsChanged: (a[x].outputs ?? []).length > 0,
        metadataChanged: false,
      };
    }
    const sourceChanged = a[x].source !== b[y].source || a[x].cell_type !== b[y].cell_type;
    const outputsChanged =
      stableJson(comparableOutputs(a[x])) !== stableJson(comparableOutputs(b[y]));
    const metadataChanged =
      stableJson(personalMetadata(a[x])) !== stableJson(personalMetadata(b[y]));
    const moved = !stayed.has(x);
    const change: CellChange = sourceChanged
      ? 'edited'
      : moved
        ? 'moved'
        : outputsChanged || metadataChanged
          ? 'outputs'
          : 'unchanged';
    return {
      change,
      old: { index: x, cell: a[x] },
      new: { index: y, cell: b[y] },
      moved,
      sourceChanged,
      outputsChanged,
      metadataChanged,
    };
  };

  // The new side's order, with each removed cell placed after the nearest cell before it in the old one
  // that stayed where it was: one that moved away is no guide to where the removed cell stood.
  const removedAfter = new Map<number, number[]>();
  let lastMatched = -1;
  for (let x = 0; x < a.length; x++) {
    if (byOld.has(x)) {
      if (stayed.has(x)) {
        lastMatched = byOld.get(x)!;
      }
    } else {
      removedAfter.set(lastMatched, [...(removedAfter.get(lastMatched) ?? []), x]);
    }
  }
  const byNew = new Map(pairs.map(([x, y]) => [y, x]));
  const cells: CellDiff[] = (removedAfter.get(-1) ?? []).map((x) => describe(x, undefined));
  for (let y = 0; y < b.length; y++) {
    cells.push(describe(byNew.get(y), y));
    for (const x of removedAfter.get(y) ?? []) {
      cells.push(describe(x, undefined));
    }
  }

  return {
    cells,
    metadataChanged: stableJson(before?.metadata ?? {}) !== stableJson(after?.metadata ?? {}),
  };
}

/** What a cell's outputs are as plain text, or null when any of them is more than text. */
export function outputsAsText(cell: DiffCell | undefined): string | null {
  const parts: string[] = [];
  for (const output of cell?.outputs ?? []) {
    if (output.output_type === 'stream') {
      parts.push(output.text ?? '');
      continue;
    }
    if (output.output_type === 'error') {
      parts.push(`${output.ename}: ${output.evalue}\n`);
      continue;
    }
    const data = output.data ?? {};
    const kinds = Object.keys(data).filter((kind) => kind !== TABLE_MIME);
    if (kinds.length === 1 && kinds[0] === 'text/plain') {
      const text = data['text/plain'];
      parts.push(`${Array.isArray(text) ? text.join('') : String(text)}\n`);
      continue;
    }
    return null;
  }
  return parts.join('');
}
