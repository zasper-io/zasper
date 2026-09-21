import React, { useRef, useState } from 'react';

import { useCommandEnabled } from '@/commands/registry';
import { Icon, type IconName } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import ContextMenu from '@/ide/sidebar/contextMenu/ContextMenu';

interface NbButtonsProps {
  /** Dispatches a command by id — see notebookCommands.ts for the ids. */
  run: (id: string) => void;
  /** Downloads the notebook file itself, which is the one row here that is not a command. */
  downloadNotebook: () => void;
  /** The focused cell's type, for the picker. Empty when there is no focused cell. */
  cellType: string;
  /** Whether the table of contents is beside the cells, which the switch shows as pressed. */
  contentsShown: boolean;
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

/**
 * The export menu.
 *
 * A flat run under one heading rather than a flyout: `ContextMenu` has no submenus, and the family's
 * answer to a menu with two kinds of row in it is a group heading. No icons, the way the tab menu's
 * rows have none; the heading is what names them.
 *
 * `Download notebook` is the thing that already existed, moved to where someone would now look for
 * it. Without it the menu says "export as" three times and stays silent about the one format Zasper
 * has always been able to hand over.
 */
const EXPORT_MENU: { id: string; label: string }[] = [
  { id: 'notebook:export-html', label: 'HTML page…' },
  { id: 'notebook:export-markdown', label: 'Markdown' },
  { id: 'notebook:export-script', label: 'Script' },
];

const CELL_TYPES = [
  { label: 'Code', value: 'code' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'Raw', value: 'raw' },
];

function NbButtons(props: NbButtonsProps) {
  // The readout is a control, so it says what pressing it does rather than what it reads.
  const kernelTip = useTooltip();
  const exportTip = useTooltip();
  const isEnabled = useCommandEnabled();
  const exportButton = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ xPos: number; yPos: number } | null>(null);

  // Off the button's own box rather than the pointer, as CellButtons does: this menu opens from a
  // control, so it has to land in the same place when the button is reached by keyboard. Right-
  // aligned to the button, because the button is at the end of the row and a menu hung from its left
  // edge would run past the pane.
  const openExportMenu = () => {
    const box = exportButton.current?.getBoundingClientRect();
    setMenuAt(box ? { xPos: box.right - 200, yPos: box.bottom + 4 } : { xPos: 0, yPos: 0 });
  };

  const exportItems = [
    ...EXPORT_MENU.map((entry) => ({
      label: entry.label,
      group: 'Export as',
      disabled: !isEnabled(entry.id),
      action: () => props.run(entry.id),
    })),
    {
      label: 'Download notebook',
      icon: 'download' as IconName,
      separated: true,
      action: props.downloadNotebook,
    },
  ];

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
      {/* Right of the picker and left of the kernel pill: everything to the left of here does
          something, and the two on the right say how the notebook *is*. */}
      <IconButton
        icon="list-tree"
        label="Table of Contents"
        pressed={props.contentsShown}
        onClick={() => props.run('notebook:toggle-contents')}
      />
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
      {/* A group of its own at the end of the row, separated like the other three. `.kernel-pill`
          already carries the row's `margin-left: auto`, so everything from there on sits at the
          right edge; without this separator the export button reads as one of the kernel's. */}
      <span className="sep" />
      <button
        ref={exportButton}
        type="button"
        className="z-icon-button"
        onClick={openExportMenu}
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        aria-label="Export"
        {...exportTip.anchorProps}
      >
        <Icon name="download" />
      </button>
      <Tooltip tip={exportTip} label="Export" />
      {menuAt && (
        <ContextMenu
          xPos={menuAt.xPos}
          yPos={menuAt.yPos}
          items={exportItems}
          onClose={() => setMenuAt(null)}
        />
      )}
    </div>
  );
}
export default NbButtons;
