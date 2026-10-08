import React, { memo } from 'react';

import { NotebookCell } from '@/api';
import { Icon } from '@/ide/icons';

import { useNotebookEditor } from './NotebookEditorContext';

/** What a cell added here can be, in the order the toolbar's cell type picker lists them. */
const KINDS: { kind: NotebookCell['cell_type'] | 'sql'; label: string }[] = [
  { kind: 'code', label: 'Code' },
  { kind: 'sql', label: 'SQL' },
  { kind: 'markdown', label: 'Markdown' },
  { kind: 'raw', label: 'Raw' },
];

interface CellInsertProps {
  /** Where a cell added here would land. */
  index: number;
  /**
   * The rail after the last cell, which is the one that is always on screen. Every other rail has
   * two cells to sit between and a pointer arrives at it on the way past; this one has nothing below
   * it to move towards, and adding a cell at the end is the insertion most often wanted. It is also
   * the only rail a keyboard can reach, which is why `Ctrl-Shift-A` and `Ctrl-Shift-B` stay in the
   * cell's menu.
   */
  isEnd?: boolean;
}

/**
 * The gap between two cells, made into somewhere to put one.
 *
 * The 12px between cells was already there; this fills it rather than adding to it, so nothing on
 * the page moves when it appears. Insertion is by index — the pointer's position — where
 * `notebook:insert-cell-above` and `-below` are both relative to whichever cell holds the focus, so
 * putting a cell somewhere with the mouse cost a click to move the focus there first.
 *
 * Labelled rather than a bare `+`, because the choice being made is which kind of cell, and an icon
 * cannot say which.
 */
function CellInsert(props: CellInsertProps) {
  const { addCellAt } = useNotebookEditor();

  return (
    <div className={props.isEnd === true ? 'cell-insert is-end' : 'cell-insert'}>
      {KINDS.map(({ kind, label }) => (
        <button
          key={kind}
          type="button"
          className="cell-insert-button"
          onClick={() => addCellAt(props.index, kind)}
        >
          <Icon name="plus" size={12} />
          {label}
        </button>
      ))}
    </div>
  );
}

export default memo(CellInsert);
