import React from 'react';

import type { IconName } from '@/ide/icons';
import { Icon } from '@/ide/icons';

interface NbButtonsProps {
  /** Dispatches a command by id — see notebookCommands.ts for the ids. */
  run: (id: string) => void;
  /** The focused cell's type, for the picker. Empty when there is no focused cell. */
  cellType: string;
  kernelName: string;
  kernelStatus: string;
}

/**
 * The notebook toolbar. Each button names a command instead of taking a callback of its own, which
 * is what collapsed this component's props from fifteen to four — and what guarantees the button
 * and the keyboard shortcut for the same action cannot diverge.
 */
const TOOLBAR_BUTTONS: { id: string; title: string; icon: IconName }[] = [
  { id: 'notebook:save', title: 'Save Notebook', icon: 'save' },
  { id: 'notebook:insert-cell-below', title: 'Add Cell Below', icon: 'plus' },
  { id: 'notebook:cut-cell', title: 'Cut Cell', icon: 'scissors' },
  { id: 'notebook:copy-cell', title: 'Copy Cell', icon: 'copy' },
  { id: 'notebook:paste-cell', title: 'Paste Cell', icon: 'clipboard-paste' },
  { id: 'notebook:run-cell', title: 'Run Cell', icon: 'play' },
  // A stop square for interrupt, as every player has: the kernel keeps its variables, so this
  // is a stop rather than the power-off the Jupyter info panel offers.
  { id: 'notebook:interrupt-kernel', title: 'Interrupt Kernel', icon: 'square' },
  { id: 'notebook:restart-kernel', title: 'Restart Kernel', icon: 'rotate-cw' },
  {
    id: 'notebook:restart-and-run-all',
    title: 'Restart Kernel and Execute all Cells',
    icon: 'fast-forward',
  },
];

const CELL_TYPES = [
  { label: 'Code', value: 'code' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'Raw', value: 'raw' },
];

function NbButtons(props: NbButtonsProps) {
  return (
    <div className="text-editor-tool">
      {TOOLBAR_BUTTONS.map((button) => (
        <button
          key={button.id}
          type="button"
          className="z-icon-button"
          onClick={() => props.run(button.id)}
          title={button.title}
        >
          <Icon name={button.icon} />
        </button>
      ))}
      {/* The picker's values are the command ids' suffixes, so there is no mapping table. A toolbar
          control carries its name rather than showing one — the row beside it is icon buttons with
          `title` — and this had neither, so it was announced as "combo box" and nothing more. */}
      <div className="z-select editor-select">
        <select
          onChange={(e) => props.run(`notebook:change-to-${e.target.value}`)}
          aria-label="Cell type"
          value={props.cellType}
        >
          {CELL_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="tool-group-end">
        <button className="kernelNameButton" onClick={() => props.run('notebook:change-kernel')}>
          {props.kernelName}
        </button>
      </div>
      <div className="kStatus">
        <span className={`kernelStatus ks-${props.kernelStatus}`}></span>
        <button
          className="z-icon-button"
          onClick={() => props.run('notebook:reconnect-kernel')}
          title="Reconnect Kernel"
          aria-label="Reconnect Kernel"
        >
          <Icon name="plug-zap" />
        </button>
      </div>
    </div>
  );
}
export default NbButtons;
