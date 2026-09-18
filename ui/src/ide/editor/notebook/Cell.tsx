import React, { memo } from 'react';

import { CellProps } from './cellShared';
import CodeCell from './CodeCell';
import MarkdownCell from './MarkdownCell';

/**
 * One cell of the notebook. Memoized: a keystroke changes one cell's object and leaves every other
 * cell's props as they were, and what the cells share comes from a context whose value is stable — so
 * typing re-renders the cell being typed in, not the notebook.
 */
function Cell(props: CellProps) {
  return props.cell.cell_type === 'markdown' ? (
    <MarkdownCell {...props} />
  ) : (
    <CodeCell {...props} />
  );
}

export default memo(Cell);
