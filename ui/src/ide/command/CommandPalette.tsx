import React, { useState, useEffect, useRef } from 'react';
import './CommandPalette.scss';

interface Command {
  name: string;
  description: string;
  action: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ commands, onClose }) => {
  const [query, setQuery] = useState('');
  const [filteredCommands, setFilteredCommands] = useState<Command[]>(commands);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const filtered = commands.filter((command) =>
      command.name.toLowerCase().includes(query.toLowerCase())
    );
    setFilteredCommands(filtered);
  }, [query, commands]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      setSelectedIndex((prevIndex) => Math.min(prevIndex + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      setSelectedIndex((prevIndex) => Math.max(prevIndex - 1, 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      filteredCommands[selectedIndex].action();
      onClose();
    }
  };

  return (
    <div className="command-palette">
      <input
        ref={inputRef}
        type="text"
        className="command-palette-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        placeholder="Type a command..."
      />
      <ul className="command-palette-list">
        {filteredCommands.map((command, index) => (
          <li
            key={command.name}
            className={`command-palette-item ${selectedIndex === index ? 'selected' : ''}`}
            onClick={() => {
              command.action();
              onClose();
            }}
          >
            <div className="commandName">{command.name}</div>
            <div className="commandName">{command.description}</div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CommandPalette;
