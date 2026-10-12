import { NotebookCell, NotebookModel } from '@/api';
import { stableJson } from '@/ide/editor/notebookDiff/cellDiff';

/**
 * A cell that changed on disk while the reader had changed it too: what the file now says, or null when
 * the file no longer has the cell.
 */
export type DiskConflicts = Record<string, NotebookCell | null>;

/**
 * A change on disk to the cell holding the cursor, held until the reader leaves the cell: `seen` is the
 * source the reader is looking at, `theirs` what the file says.
 */
export type HeldChanges = Record<string, { seen: string; theirs: NotebookCell }>;

export interface DiskMerge {
  notebook: NotebookModel;
  conflicts: DiskConflicts;
  held: HeldChanges;
  /** Cells added, changed or removed from the file without asking. */
  takenIn: number;
}

/** What the reader typed into a cell: its kind and source. Outputs belong to the kernel session. */
function sameSource(a: NotebookCell | undefined, b: NotebookCell | undefined): boolean {
  return a !== undefined && b !== undefined && a.cell_type === b.cell_type && a.source === b.source;
}

function sameOutputs(a: NotebookCell | undefined, b: NotebookCell | undefined): boolean {
  return (
    stableJson(a?.outputs ?? []) === stableJson(b?.outputs ?? []) &&
    (a?.execution_count ?? null) === (b?.execution_count ?? null)
  );
}

/** The file's version of a cell, keeping the outputs this session's kernel gave it since the base. */
function fromDisk(
  theirs: NotebookCell,
  mine: NotebookCell | undefined,
  base: NotebookCell | undefined
) {
  const cell: NotebookCell = { ...theirs, reload: false };
  if (mine !== undefined && !sameOutputs(mine, base)) {
    cell.outputs = mine.outputs;
    cell.execution_count = mine.execution_count;
  }
  return cell;
}

function byId(cells: NotebookCell[]): Map<string, NotebookCell> {
  return new Map(cells.map((cell) => [cell.id, cell]));
}

/**
 * Brings a change on disk into the open notebook cell by cell, against `base`, the version last read.
 *
 * A cell the reader has not touched takes the file's version, and one only the reader changed keeps
 * theirs. A cell both changed differently is a conflict: the reader's version stays, and the file's is
 * kept beside it to choose from. Outputs never conflict: a cell keeps the outputs this session's kernel
 * gave it, and otherwise takes the file's. The cell holding the cursor is not changed under it, but held.
 *
 * Null when the cells cannot be matched by id, which only a notebook from nbformat 4.5 on can do.
 */
export function mergeFromDisk(
  base: NotebookModel,
  mine: NotebookModel,
  theirs: NotebookModel,
  focusedCellId: string | null,
  held: HeldChanges = {}
): DiskMerge | null {
  if (
    theirs.nbformat_minor < 5 ||
    base.nbformat_minor < 5 ||
    [base, theirs].some((side) => side.cells.some((cell) => !cell.id))
  ) {
    return null;
  }
  const baseCells = byId(base.cells);
  const theirCells = byId(theirs.cells);
  const conflicts: DiskConflicts = {};
  const stillHeld: HeldChanges = {};
  let takenIn = 0;

  const cells: NotebookCell[] = [];
  for (const mineCell of mine.cells) {
    const theirCell = theirCells.get(mineCell.id);
    // A held cell is compared with what the reader is looking at, not with the file, which has moved on.
    const seen = held[mineCell.id];
    const baseCell =
      seen === undefined ? baseCells.get(mineCell.id) : { ...mineCell, source: seen.seen };
    const mineChanged = baseCell === undefined || !sameSource(mineCell, baseCell);

    if (theirCell === undefined) {
      if (baseCell === undefined) {
        cells.push(mineCell); // added here
      } else if (mineChanged) {
        cells.push(mineCell);
        conflicts[mineCell.id] = null;
      } else {
        takenIn += 1; // deleted on disk
      }
      continue;
    }

    const theirsChanged = baseCell === undefined || !sameSource(theirCell, baseCell);
    if (!theirsChanged) {
      cells.push(
        sameOutputs(theirCell, baseCell) || !sameOutputs(mineCell, baseCell)
          ? mineCell
          : { ...mineCell, outputs: theirCell.outputs, execution_count: theirCell.execution_count }
      );
    } else if (!mineChanged) {
      if (mineCell.id === focusedCellId) {
        cells.push(mineCell);
        stillHeld[mineCell.id] = { seen: mineCell.source, theirs: theirCell };
      } else {
        cells.push(fromDisk(theirCell, mineCell, baseCell));
        takenIn += 1;
      }
    } else {
      cells.push(mineCell);
      if (!sameSource(mineCell, theirCell)) {
        conflicts[mineCell.id] = theirCell;
      }
    }
  }

  // Cells the file has and this document does not: added on disk, placed after the cell they follow.
  const placed = new Set(cells.map((cell) => cell.id));
  theirs.cells.forEach((theirCell, index) => {
    if (placed.has(theirCell.id) || baseCells.has(theirCell.id)) {
      return;
    }
    const before = theirs.cells
      .slice(0, index)
      .reverse()
      .find((cell) => placed.has(cell.id));
    const at = before === undefined ? 0 : cells.findIndex((cell) => cell.id === before.id) + 1;
    cells.splice(at, 0, { ...theirCell, reload: false });
    placed.add(theirCell.id);
    takenIn += 1;
  });

  const metadata =
    stableJson(mine.metadata) === stableJson(base.metadata) ? theirs.metadata : mine.metadata;
  return {
    notebook: {
      ...mine,
      nbformat: theirs.nbformat,
      nbformat_minor: theirs.nbformat_minor,
      metadata,
      cells,
    },
    conflicts,
    held: stillHeld,
    takenIn,
  };
}
