import React from 'react';

import { NotebookModel } from '@/api';

import Cell from './Cell';
import CellInsert from './CellInsert';

interface NotebookCellsProps {
  notebook: NotebookModel;
  /** The cells the kernel is currently running, so each can show a spinner for as long as it is. */
  runningCellIds: ReadonlySet<string>;
  /** The cells whose output has been let past its height cap. */
  expandedOutputs: ReadonlySet<string>;
  /** The markdown cell whose source is open, if any. */
  editingCellId: string | null;
}

/**
 * Renders the notebook body: one <Cell> per cell, in document order. What the cells share comes from
 * NotebookEditorContext; what is particular to each is worked out here.
 */
export default function NotebookCells({
  notebook,
  runningCellIds,
  expandedOutputs,
  editingCellId,
}: NotebookCellsProps) {
  if (!notebook.cells) {
    return null;
  }

  return (
    <>
      {notebook.cells.map((cell, index) => (
        <React.Fragment key={cell.id}>
          {/* Above every cell, so the first one can be inserted before too. The rail eats the gap
              the cell above already leaves, so at rest the notebook is laid out as it was. */}
          <CellInsert index={index} />
          <Cell
            index={index}
            cell={cell}
            isRunning={runningCellIds.has(cell.id)}
            isOutputExpanded={expandedOutputs.has(cell.id)}
            isEditing={editingCellId === cell.id}
          />
        </React.Fragment>
      ))}
      <CellInsert index={notebook.cells.length} isEnd />
    </>
  );
}
