import React, { useMemo, useRef, useState } from 'react';

import type { ICell } from '@/api';
import { formatChord } from '@/commands/keys';
import { useCommandEnabled, useCommands } from '@/commands/registry';
import type { IconName } from '@/ide/icons';
import { Icon } from '@/ide/icons';
import ContextMenu from '@/ide/sidebar/ContextMenu/ContextMenu';

interface CellButtonsProps {
  /** Dispatches a command by id — see notebookCommands.ts for the ids. */
  run: (id: string) => void;
  /** The cell's type, so the menu can mark which of the three it currently is. */
  cellType: ICell['cell_type'];
}

/**
 * The two actions that are a cell's own. Everything else that used to be here is now either in the
 * notebook toolbar 40px above the first cell — which already holds save, insert, cut, copy, paste,
 * run, interrupt, restart and run-all — in the gutter beside the code, in the rail between two
 * cells, or in the menu below.
 *
 * Moving a cell is the one thing with no other home, and the only pair left where the arrowheads
 * have to be read: the chevrons that used to sit beside these moved the *selection* and are in the
 * palette, where a name says which is which.
 */
const CELL_BUTTONS: { id: string; title: string; icon: IconName }[] = [
  { id: 'notebook:move-cell-up', title: 'Move Cell Up', icon: 'arrow-up' },
  { id: 'notebook:move-cell-down', title: 'Move Cell Down', icon: 'arrow-down' },
];

/**
 * What the eleven-icon strip became: rows with names, their keybinding beside them, and the one
 * separator this family allows spent on the row that throws work away.
 *
 * `type` marks the three that are alternatives rather than verbs — a cell is code or markdown or
 * raw, and drawing that as three identical rows made it a guess which one it currently was.
 */
const CELL_MENU: {
  id: string;
  label: string;
  icon: IconName;
  group?: string;
  type?: ICell['cell_type'];
  danger?: boolean;
}[] = [
  {
    id: 'notebook:run-cell-and-advance',
    label: 'Run and Select Next',
    icon: 'corner-down-left',
    group: 'Cell',
  },
  { id: 'notebook:cut-cell', label: 'Cut Cell', icon: 'scissors', group: 'Cell' },
  { id: 'notebook:copy-cell', label: 'Copy Cell', icon: 'copy', group: 'Cell' },
  { id: 'notebook:paste-cell', label: 'Paste Below', icon: 'clipboard-paste', group: 'Cell' },
  { id: 'notebook:change-to-code', label: 'Code', icon: 'file-code', group: 'Type', type: 'code' },
  {
    id: 'notebook:change-to-markdown',
    label: 'Markdown',
    icon: 'pencil',
    group: 'Type',
    type: 'markdown',
  },
  { id: 'notebook:change-to-raw', label: 'Raw', icon: 'file', group: 'Type', type: 'raw' },
  {
    id: 'notebook:toggle-output-height',
    label: 'Expand Output',
    icon: 'scroll-text',
    group: 'Output',
  },
  { id: 'notebook:clear-cell-outputs', label: 'Clear Output', icon: 'eraser', group: 'Output' },
  // No group, so no heading is drawn for it: it sits alone under the separator the menu derives
  // from `danger`.
  { id: 'notebook:delete-cell', label: 'Delete Cell', icon: 'trash-2', danger: true },
];

/**
 * The bar over a cell. It is rendered for every cell rather than only the focused one and revealed
 * by CSS on hover, on focus, and on `:focus-within` — before this it was mounted only when
 * `index === focusedIndex`, so a pointer had to click a cell before that cell had any options at
 * all, and the "hover toolbar" both this file and the stylesheet described did not exist.
 */
function CellButtons(props: CellButtonsProps) {
  const commands = useCommands();
  const isEnabled = useCommandEnabled();
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ xPos: number; yPos: number } | null>(null);

  // The chord comes off the command rather than being written here, so the row and the keyboard
  // cannot drift apart — the same reason the buttons name a command instead of taking a callback.
  const chords = useMemo(() => {
    const found = new Map<string, string>();
    for (const command of commands) {
      if (command.keys && command.keys.length > 0) {
        found.set(command.id, formatChord(command.keys[0]));
      }
    }
    return found;
  }, [commands]);

  // Off the button's own box, not the pointer: this menu opens from a control rather than from a
  // right-click, so it has to land in the same place when the button is reached by keyboard.
  const openMenu = () => {
    const box = menuButton.current?.getBoundingClientRect();
    setMenuAt(box ? { xPos: box.left, yPos: box.bottom + 2 } : { xPos: 0, yPos: 0 });
  };

  const items = CELL_MENU.map((entry) => ({
    label: entry.label,
    icon: entry.icon,
    group: entry.group,
    keys: chords.get(entry.id),
    // A cell is one of the three types; the row saying which one is not a thing to press again.
    selected: entry.type !== undefined && entry.type === props.cellType,
    disabled: !isEnabled(entry.id) || entry.type === props.cellType,
    danger: entry.danger,
    action: () => props.run(entry.id),
  }));

  return (
    <div className="cellOptions">
      {CELL_BUTTONS.map((button) => (
        <button
          key={button.id}
          type="button"
          className="z-icon-button"
          onClick={() => props.run(button.id)}
          disabled={!isEnabled(button.id)}
          title={button.title}
          aria-label={button.title}
        >
          <Icon name={button.icon} />
        </button>
      ))}
      <span className="sep" />
      <button
        ref={menuButton}
        type="button"
        className="z-icon-button"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        title="More cell actions"
        aria-label="More cell actions"
      >
        <Icon name="ellipsis" />
      </button>
      {menuAt && (
        <ContextMenu
          xPos={menuAt.xPos}
          yPos={menuAt.yPos}
          items={items}
          onClose={() => setMenuAt(null)}
        />
      )}
    </div>
  );
}

export default CellButtons;
