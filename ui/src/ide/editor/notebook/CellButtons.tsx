import React from 'react';

import type { IconName } from '@/ide/icons';
import { Icon } from '@/ide/icons';

interface CellButtonsProps {
  /** Dispatches a command by id — see notebookCommands.ts for the ids. */
  run: (id: string) => void;
}

const CELL_BUTTONS: { id: string; title: string; icon: IconName }[] = [
  { id: 'notebook:run-cell', title: 'Run cell', icon: 'play' },
  { id: 'notebook:copy-cell', title: 'Copy cell', icon: 'copy' },
  // Chevrons rather than the transport arrows these had: moving the cursor down the notebook is
  // not playback, and fast-forward already means restart-and-run-all in the toolbar above.
  { id: 'notebook:select-next-cell', title: 'Select cell below', icon: 'chevron-down' },
  { id: 'notebook:select-previous-cell', title: 'Select cell above', icon: 'chevron-up' },
  {
    id: 'notebook:insert-cell-above',
    title: 'Insert cell above',
    icon: 'between-horizontal-start',
  },
  { id: 'notebook:insert-cell-below', title: 'Insert cell below', icon: 'between-horizontal-end' },
  { id: 'notebook:delete-cell', title: 'Delete cell', icon: 'trash-2' },
];

/**
 * The hover toolbar on a cell. It is only ever rendered for the focused cell (see Cell.tsx), so
 * every button here is an action on the focused cell and needs no index of its own — which is what
 * lets them all be plain command ids.
 */
function CellButtons(props: CellButtonsProps) {
  return (
    <div className="cellOptionsDiv">
      <div className="cellOptions">
        {CELL_BUTTONS.map((button) => (
          <button
            key={button.id}
            type="button"
            className="z-icon-button"
            onClick={() => props.run(button.id)}
            title={button.title}
            aria-label={button.title}
          >
            <Icon name={button.icon} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default CellButtons;
