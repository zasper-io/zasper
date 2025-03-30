import React, { useState, useEffect, useCallback } from 'react';
import './TopBar.scss';
import CommandPalette from './command/CommandPalette';
import FileAutocomplete from './search/FileSearch';
import { useAtom } from 'jotai';
import { userNameAtom } from '../../store/AppState';

export default function Topbar() {
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showFileAutocomplete, setShowFileAutocomplete] = useState<boolean>(false);
  const [userName] = useAtom(userNameAtom);

  const commands = [
    {
      name: 'Open Project',
      description: 'Open a new project directory',
      action: () => alert('Opening project...'),
    },
    {
      name: 'Run Command',
      description: 'Run a custom command in terminal',
      action: () => alert('Running command...'),
    },
    {
      name: 'Close Editor',
      description: 'Close the current editor window',
      action: () => alert('Closing editor...'),
    },
    // Add more commands as needed
  ];

  // Toggle functions wrapped in useCallback
  const toggleCommandPalette = useCallback(() => {
    setShowCommandPalette((prev) => !prev);
  }, []);

  const toggleFileAutoComplete = useCallback(() => {
    setShowFileAutocomplete((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'P') {
        toggleCommandPalette(); // Open the command palette when the shortcut is pressed
      } else if (event.ctrlKey && event.shiftKey && event.key === 'O') {
        toggleFileAutoComplete(); // Open the command palette when the shortcut is pressed
      } else if (event.key === 'Escape') {
        setShowCommandPalette(false); // Close palette with Escape key
        setShowFileAutocomplete(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleCommandPalette, toggleFileAutoComplete]);

  return (
    <div className="topBar">
      <div className="container-fluid">
        <div className="row">
          <div className="col-3">
            <img className="logo-white" src="./images/logo-white.svg" alt="#" />
          </div>
          <div className="col-8">
            <div className="searchArea">
              <div className="search-wraper">
                <button className="openCommandPaletteButton" onClick={toggleFileAutoComplete}>
                  Type your search here <img src="./images/icons/search.svg" alt="#" />
                </button>
              </div>
            </div>
            <div>
              {showCommandPalette && (
                <CommandPalette commands={commands} onClose={() => setShowCommandPalette(false)} />
              )}
              {showFileAutocomplete && (
                <FileAutocomplete onClose={() => setShowFileAutocomplete(false)} />
              )}
            </div>
          </div>
          <div className="col-1">
            <div className="userName">
              <span>{userName}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
