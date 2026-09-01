import React, { useState, useEffect, useCallback, useRef } from 'react';
import './Topbar.scss';
import CommandPalette from './command/CommandPalette';
import FileAutocomplete from './search/FileSearch';
import { useAtom } from 'jotai';
import { protectedStateAtom, userNameAtom } from '@/store/AppState';
import { useNavigate } from 'react-router-dom';

export default function Topbar() {
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showFileAutocomplete, setShowFileAutocomplete] = useState<boolean>(false);
  const [userName] = useAtom(userNameAtom);
  const [protectedState] = useAtom(protectedStateAtom);
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const isPaletteOpen = showCommandPalette || showFileAutocomplete;

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

  // Clicking away dismisses, as Escape does. Both palettes render inside .searchArea, as does
  // the button that opens them, so one containment check covers all three: a click on the
  // button falls through to its own toggle instead of being closed and reopened.
  //
  // `mousedown` rather than `click`, so the palette is gone before the thing underneath takes
  // focus — a click into a notebook cell should land in the cell.
  useEffect(() => {
    if (!isPaletteOpen) {
      return;
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (searchAreaRef.current?.contains(event.target as Node)) {
        return;
      }
      setShowCommandPalette(false);
      setShowFileAutocomplete(false);
    };

    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isPaletteOpen]);

  return (
    // A three-part flex row, not a 12-column grid: the two side groups flex equally, so the
    // search box is centred on the window rather than on whatever the columns leave.
    <div className="topBar">
      <div className="topBar-side">
        {/* Not an <img>: which wordmark file to use depends on whether the topbar is
            dark or light, which comes from --z-logo so that no component has to branch
            on the theme name. */}
        <span className="zasperLogo" role="img" aria-label="Zasper" />
      </div>
      <div className="searchArea" ref={searchAreaRef}>
        <div className="search-wraper">
          <button className="openCommandPaletteButton" onClick={toggleFileAutoComplete}>
            Type your search here
          </button>
        </div>
        {showCommandPalette && (
          <CommandPalette commands={commands} onClose={() => setShowCommandPalette(false)} />
        )}
        {showFileAutocomplete && (
          <FileAutocomplete onClose={() => setShowFileAutocomplete(false)} />
        )}
        {/* Outside the button, and painted over the palette, so the same magnifier sits in the
            same place whether the button or the palette's input is the field on screen. */}
        <img className="searchIcon" src="./images/icons/search.svg" alt="" />
      </div>
      <div className="topBar-side topBar-side-end">
        <div className="userName">
          <span>{userName}</span>
          {protectedState ? <LogoutButton /> : <></>}
        </div>
      </div>
    </div>
  );
}

const LogoutButton = () => {
  const navigate = useNavigate();

  const logout = () => {
    console.log('Logging out...');
    localStorage.removeItem('token'); // Remove token from local storage
    navigate('/login');
  };

  return (
    <button className="logoutButton" onClick={logout}>
      <img src="./images/icons/logout.svg" alt="" />
    </button>
  );
};
