import React, { useState, useEffect, useMemo, useRef } from 'react';
import '../palette.scss';
import { IContentEntry, searchFiles } from '@/api';
import { debounce } from 'lodash';
import { useAtom } from 'jotai';
import { fileTabsAtom, IfileTab } from '@/store/TabState';
import getFileExtension from '@/ide/utils';

interface FileSearchProps {
  onClose: () => void;
}

const FileSearch = ({ onClose }: FileSearchProps) => {
  const [input, setInput] = useState('');
  const [fileSuggestions, setFileSuggestions] = useState<IContentEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  // Kept in a ref so results survive re-renders; a plain object would be rebuilt
  // on every keystroke and never hit.
  const cache = useRef<Record<string, IContentEntry[]>>({});

  const [fileTabsState, setFileTabsState] = useAtom(fileTabsAtom);

  const handleTabActivate = (name: string, path: string, type: string, kernelspec: string) => {
    const updatedFileTabs = { ...fileTabsState };
    const fileTabData: IfileTab = {
      type,
      path,
      name,
      extension: getFileExtension(name),
      active: true,
      load_required: true,
      kernelspec: kernelspec,
    };

    Object.keys(updatedFileTabs).forEach((key) => {
      updatedFileTabs[key] = {
        ...updatedFileTabs[key],
        active: false,
        load_required: false,
      };
    });
    if (updatedFileTabs[path]) {
      updatedFileTabs[path] = { ...updatedFileTabs[path], active: true };
    } else {
      updatedFileTabs[path] = fileTabData;
    }
    setFileTabsState(updatedFileTabs);
  };

  const handleFileClick = (name: string, path: string, type: string) => {
    handleTabActivate(name, path, type, 'none');
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      setSelectedIndex((prevIndex) => Math.min(prevIndex + 1, fileSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      setSelectedIndex((prevIndex) => Math.max(prevIndex - 1, 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      var file = fileSuggestions[selectedIndex];
      handleTabActivate(file.name, file.path, file.type, 'none');
      onClose();
    }
  };

  const debouncedFetchFiles = useMemo(
    () =>
      debounce(async (query: string) => {
        if (cache.current[query]) {
          setFileSuggestions(cache.current[query]);
          return;
        }
        if (query.length > 0) {
          try {
            const results = await searchFiles(query);
            cache.current[query] = results;
            setFileSuggestions(results);
          } catch (error) {
            console.error('Error fetching file suggestions:', error);
          }
        } else {
          setFileSuggestions([]);
        }
      }, 100),
    []
  );

  useEffect(() => () => debouncedFetchFiles.cancel(), [debouncedFetchFiles]);

  useEffect(() => {
    debouncedFetchFiles(input);
  }, [input, debouncedFetchFiles]); // Triggered whenever `input` changes

  return (
    <div className="palette">
      <input
        className="palette-input"
        type="text"
        // The palette covers the button that opened it, so without this the user would be
        // looking at an input that needs a second click before it takes a keystroke.
        autoFocus
        onKeyDown={handleKeyDown}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type a file name..."
      />
      <ul className="palette-list">
        {fileSuggestions &&
          fileSuggestions.length > 0 &&
          fileSuggestions.map((file, index) => (
            <li
              key={index}
              onClick={() => handleFileClick(file.name, file.path, file.type)}
              className={`palette-item ${selectedIndex === index ? 'selected' : ''}`}
            >
              <div className="commandName">{file.name}</div>
              <div className="commandDescription">{file.path}</div>
            </li>
          ))}
      </ul>
    </div>
  );
};

export default FileSearch;
