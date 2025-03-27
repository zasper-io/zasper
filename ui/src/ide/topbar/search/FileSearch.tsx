import React, { useState, useEffect, useCallback } from 'react';
import '../command/CommandPalette.scss';
import { BaseApiUrl } from '../../config';
import { debounce } from 'lodash';

interface IContent {
  type: string;
  path: string;
  name: string;
  content: IContent[];
}

const FileSearch = ({ sendDataToParent, onClose }) => {
  const [input, setInput] = useState('');
  const [fileSuggestions, setFileSuggestions] = useState<IContent[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const cache = {};

  const handleFileClick = (name: string, path: string, type: string) => {
    sendDataToParent(name, path, type);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      setSelectedIndex((prevIndex) => Math.min(prevIndex + 1, fileSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      setSelectedIndex((prevIndex) => Math.max(prevIndex - 1, 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      var file = fileSuggestions[selectedIndex];
      sendDataToParent(file.name, file.path, file.type);
      onClose();
    }
  };

  const debouncedFetch = debounce(async (query) => {
    if (cache[query]) {
      setFileSuggestions(cache[query]);
      return;
    }
    if (query.length > 0) {
      try {
        const response = await fetch(`${BaseApiUrl}/api/files?query=${query}`);
        const files = await response.json();
        setFileSuggestions(files);
      } catch (error) {
        console.error('Error fetching file suggestions:', error);
      }
    } else {
      setFileSuggestions([]);
    }
  }, 100);

  const debouncedFetchFiles = useCallback(
    (query) => {
      debouncedFetch(query);
    },
    [debouncedFetch]
  );

  useEffect(() => {
    debouncedFetchFiles(input);
  }, [input, debouncedFetchFiles]); // Triggered whenever `input` changes

  return (
    <div className="command-palette">
      <input
        className="command-palette-input"
        type="text"
        onKeyDown={handleKeyDown}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type a file name..."
      />
      <ul className="command-palette-list">
        {fileSuggestions &&
          fileSuggestions.length > 0 &&
          fileSuggestions.map((file, index) => (
            <li
              key={index}
              onClick={() => handleFileClick(file.name, file.path, file.type)}
              className={`command-palette-item ${selectedIndex === index ? 'selected' : ''}`}
            >
              {file.name} -- {file.path}
            </li>
          ))}
      </ul>
    </div>
  );
};

export default FileSearch;
