import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './Topbar.scss';
import CommandPalette from './command/CommandPalette';
import FileAutocomplete from './search/FileSearch';
import { useAtom } from 'jotai';
import { protectedStateAtom, userNameAtom } from '@/store/AppState';
import { useNavigate } from 'react-router-dom';

import { useCommands, useRegisterCommands } from '@/commands/registry';
import { ICommand } from '@/commands/types';

export default function Topbar() {
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showFileAutocomplete, setShowFileAutocomplete] = useState<boolean>(false);
  const [userName] = useAtom(userNameAtom);
  const [protectedState] = useAtom(protectedStateAtom);
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const isPaletteOpen = showCommandPalette || showFileAutocomplete;

  // Everything registered right now, which is what the palette lists. Previously three
  // hardcoded entries whose bodies were alert() calls.
  const commands = useCommands();

  // Toggle functions wrapped in useCallback
  const toggleCommandPalette = useCallback(() => {
    setShowCommandPalette((prev) => !prev);
  }, []);

  const toggleFileAutoComplete = useCallback(() => {
    setShowFileAutocomplete((prev) => !prev);
  }, []);

  // The two palettes are commands like any other, registered here because this is where their
  // state lives. Their chords used to be a `keydown` listener of their own.
  const paletteCommands = useMemo<ICommand[]>(
    () => [
      {
        id: 'palette:open-commands',
        label: 'Show All Commands',
        category: 'View',
        scope: 'app',
        // Cmd is what every other editor uses on mac, but Ctrl is what this app was bound to
        // before, so both are accepted and nobody's habit breaks. (Off mac they are the same
        // chord, and the palette dedupes the display.)
        keys: ['Mod-Shift-p', 'Ctrl-Shift-p'],
        execute: toggleCommandPalette,
      },
      {
        id: 'palette:open-files',
        label: 'Go to File',
        category: 'View',
        scope: 'app',
        keys: ['Mod-Shift-o', 'Ctrl-Shift-o'],
        execute: toggleFileAutoComplete,
      },
    ],
    [toggleCommandPalette, toggleFileAutoComplete]
  );
  useRegisterCommands(paletteCommands);

  // Escape stays a plain listener rather than a command: it is a dismissal, it has to work while
  // the palette's own input has focus, and it is meaningless when nothing is open.
  useEffect(() => {
    if (!isPaletteOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowCommandPalette(false);
        setShowFileAutocomplete(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPaletteOpen]);

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
