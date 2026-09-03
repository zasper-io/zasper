import React from 'react';

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
const TOOLBAR_BUTTONS: { id: string; title: string; icon: string }[] = [
  { id: 'notebook:save', title: 'Save Notebook', icon: 'fas fa-save' },
  { id: 'notebook:insert-cell-below', title: 'Add Cell Below', icon: 'fas fa-plus' },
  { id: 'notebook:cut-cell', title: 'Cut Cell', icon: 'fas fa-cut' },
  { id: 'notebook:copy-cell', title: 'Copy Cell', icon: 'fas fa-copy' },
  { id: 'notebook:paste-cell', title: 'Paste Cell', icon: 'fas fa-paste' },
  { id: 'notebook:run-cell', title: 'Run Cell', icon: 'fas fa-play' },
  { id: 'notebook:interrupt-kernel', title: 'Interrupt Kernel', icon: 'fas fa-square' },
  { id: 'notebook:restart-kernel', title: 'Restart Kernel', icon: 'fas fa-redo' },
  {
    id: 'notebook:restart-and-run-all',
    title: 'Restart Kernel and Execute all Cells',
    icon: 'fas fa-forward',
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
          className="editor-button"
          onClick={() => props.run(button.id)}
          title={button.title}
        >
          <i className={button.icon} />
        </button>
      ))}
      {/* The picker's values are the command ids' suffixes, so there is no mapping table. */}
      <select
        onChange={(e) => props.run(`notebook:change-to-${e.target.value}`)}
        className="editor-select"
        value={props.cellType}
      >
        {CELL_TYPES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="tool-group-end">
        <button className="editor-button" onClick={() => props.run('notebook:change-kernel')}>
          {props.kernelName}
        </button>
      </div>
      <div className="kStatus">
        <span className={`kernelStatus ks-${props.kernelStatus}`}></span>
        <button className="reconnectButton" onClick={() => props.run('notebook:reconnect-kernel')}>
          <img
            src="./images/editor/reconnect-icon.svg"
            title="Reconnect Kernel"
            alt="Reconnect"
          ></img>
        </button>
      </div>
    </div>
  );
}
export default NbButtons;
