import React, { useState, useEffect, useMemo, useRef } from 'react';
import '../palette.scss';

import { formatChord } from '@/commands/keys';
import { ICommand } from '@/commands/types';

interface CommandPaletteProps {
  commands: ICommand[];
  onClose: () => void;
}

/**
 * Lists the command registry. The commands are whatever is registered right now, so what the
 * palette offers follows the active tab — it is not a hardcoded menu, as it was before.
 */
const CommandPalette: React.FC<CommandPaletteProps> = ({ commands, onClose }) => {
  const [query, setQuery] = useState('');
  // The first match is selected from the start, so typing a query and pressing Enter runs it — the
  // palette used to open with nothing selected, which made Enter do nothing until you arrowed down.
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Category as well as label, so "notebook" finds the notebook's commands whatever they are called.
  const filteredCommands = useMemo(() => {
    const needle = query.toLowerCase();
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.category.toLowerCase().includes(needle)
    );
  }, [query, commands]);

  // The list shrinks as the query grows, so a selection made earlier can end up past its end. It
  // lands on -1, i.e. nothing selected, only when the query matches nothing at all.
  useEffect(() => {
    setSelectedIndex((index) => Math.min(Math.max(index, 0), filteredCommands.length - 1));
  }, [filteredCommands]);

  const run = (command: ICommand) => {
    if (isDisabled(command)) {
      return;
    }
    command.execute();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      setSelectedIndex((prevIndex) => Math.min(prevIndex + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      setSelectedIndex((prevIndex) => Math.max(prevIndex - 1, 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      run(filteredCommands[selectedIndex]);
    }
  };

  return (
    <div className="palette">
      <input
        ref={inputRef}
        type="text"
        className="palette-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        placeholder="Type a command..."
      />
      <ul className="palette-list">
        {filteredCommands.map((command, index) => (
          <li
            key={command.id}
            className={paletteItemClass(command, selectedIndex === index)}
            onClick={() => run(command)}
          >
            <div className="commandName">{command.label}</div>
            <div className="commandDescription">{command.description ?? command.category}</div>
            {/* Rendered from the same binding strings the keyboard dispatches, so the two cannot
                disagree. Deduped: off mac, `Mod-` and `Ctrl-` spellings collapse to one chord. */}
            <div className="commandKeys">{formatKeys(command.keys)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
};

function formatKeys(keys: string[] | undefined): string {
  if (!keys?.length) {
    return '';
  }
  return Array.from(new Set(keys.map((binding) => formatChord(binding)))).join(' ');
}

/**
 * A command that cannot run right now is shown dimmed rather than hidden: "Restart Kernel, greyed
 * out" answers the question that a missing row only raises.
 */
function isDisabled(command: ICommand): boolean {
  return command.isEnabled ? !command.isEnabled() : false;
}

function paletteItemClass(command: ICommand, selected: boolean): string {
  return ['palette-item', selected ? 'selected' : '', isDisabled(command) ? 'disabled' : '']
    .filter(Boolean)
    .join(' ');
}

export default CommandPalette;
