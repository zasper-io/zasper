import React from 'react';

import type { IconName } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';

interface NbButtonsProps {
  /** Dispatches a command by id — see notebookCommands.ts for the ids. */
  run: (id: string) => void;
  /** The focused cell's type, for the picker. Empty when there is no focused cell. */
  cellType: string;
  kernelName: string;
  /** The kernelspec's own name for itself, when the specs have been read. */
  kernelDisplayName?: string;
  kernelStatus: string;
}

/**
 * The notebook toolbar. Each button names a command instead of taking a callback of its own, which
 * is what collapsed this component's props from fifteen to four — and what guarantees the button
 * and the keyboard shortcut for the same action cannot diverge.
 *
 * Three groups, separated rather than spaced: what you do to the file, what you do to a cell, and
 * what you do to the kernel. The row had one gap between everything in it, so the only thing its
 * spacing said was that there were nine buttons.
 */
const TOOLBAR_GROUPS: { id: string; title: string; icon: IconName }[][] = [
  [{ id: 'notebook:save', title: 'Save Notebook', icon: 'save' }],
  [
    { id: 'notebook:insert-cell-below', title: 'Add Cell Below', icon: 'plus' },
    { id: 'notebook:cut-cell', title: 'Cut Cell', icon: 'scissors' },
    { id: 'notebook:copy-cell', title: 'Copy Cell', icon: 'copy' },
    { id: 'notebook:paste-cell', title: 'Paste Cell', icon: 'clipboard-paste' },
  ],
  [
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
  ],
];

const CELL_TYPES = [
  { label: 'Code', value: 'code' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'Raw', value: 'raw' },
];

function NbButtons(props: NbButtonsProps) {
  // The readout is a control, so it says what pressing it does rather than what it reads.
  const kernelTip = useTooltip();

  return (
    <div className="text-editor-tool">
      {TOOLBAR_GROUPS.map((group, index) => (
        <React.Fragment key={group[0].id}>
          {index > 0 && <span className="sep" />}
          {group.map((button) => (
            <IconButton
              key={button.id}
              icon={button.icon}
              label={button.title}
              onClick={() => props.run(button.id)}
            />
          ))}
        </React.Fragment>
      ))}
      <span className="sep" />
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
      {/* The kernelspec's display name, not its id: `python3` is what the directory is called and
          `Python 3 (ipykernel)` is what the kernel calls itself, which is the name every other
          Jupyter front end shows. It falls back to the id, because the specs are a separate request
          and this readout must not be blank while it is in flight. */}
      <button
        className="kernel-pill"
        onClick={() => props.run('notebook:change-kernel')}
        {...kernelTip.anchorProps}
      >
        <span className={`kernelStatus ks-${props.kernelStatus}`} />
        {props.kernelDisplayName ?? props.kernelName}
      </button>
      <Tooltip tip={kernelTip} label="Change Kernel" />
      <IconButton
        icon="plug-zap"
        label="Reconnect Kernel"
        onClick={() => props.run('notebook:reconnect-kernel')}
      />
    </div>
  );
}
export default NbButtons;
