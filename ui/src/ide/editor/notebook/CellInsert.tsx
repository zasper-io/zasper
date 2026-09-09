import React from 'react';

import type { ICell } from '@/api';
import { Icon } from '@/ide/icons';

interface CellInsertProps {
  /** Where a cell added here would land. */
  index: number;
  addCellAt: (index: number, cellType: ICell['cell_type']) => void;
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
 * Labelled rather than a bare `+`, because the choice being made is Code or Markdown and an icon
 * cannot say which.
 */
export default function CellInsert(props: CellInsertProps) {
  return (
    <div className={props.isEnd === true ? 'cell-insert is-end' : 'cell-insert'}>
      <button
        type="button"
        className="cell-insert-button"
        onClick={() => props.addCellAt(props.index, 'code')}
      >
        <Icon name="plus" size={12} />
        Code
      </button>
      <button
        type="button"
        className="cell-insert-button"
        onClick={() => props.addCellAt(props.index, 'markdown')}
      >
        <Icon name="plus" size={12} />
        Markdown
      </button>
    </div>
  );
}
