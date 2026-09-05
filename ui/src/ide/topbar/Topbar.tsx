import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './Topbar.scss';
import Palette, { COMMANDS_ONLY } from './palette/Palette';
import { useAtom } from 'jotai';
import { protectedStateAtom, userNameAtom } from '@/store/AppState';
import { useNavigate } from 'react-router-dom';

import { useCommands, useRegisterCommands } from '@/commands/registry';
import { ICommand } from '@/commands/types';

export default function Topbar() {
  // The query the palette is showing, or null when it is closed. One piece of state rather than a
  // flag per palette, because there is one palette now: the two chords differ only in what they
  // type into it.
  const [paletteQuery, setPaletteQuery] = useState<string | null>(null);
  const [userName] = useAtom(userNameAtom);
  const [protectedState] = useAtom(protectedStateAtom);
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const isPaletteOpen = paletteQuery !== null;

  // Everything registered right now, which is what the palette lists. Previously three
  // hardcoded entries whose bodies were alert() calls.
  const commands = useCommands();

  const closePalette = useCallback(() => setPaletteQuery(null), []);

  // Opens the palette with `query` already in the field, or closes it when that is what it is
  // already showing — so a chord pressed twice dismisses, as both of them used to.
  const togglePalette = useCallback((query: string) => {
    setPaletteQuery((current) => (current === query ? null : query));
  }, []);

  const openCommands = useCallback(() => togglePalette(COMMANDS_ONLY), [togglePalette]);
  const openFiles = useCallback(() => togglePalette(''), [togglePalette]);

  // Both ways into the palette are commands like any other, registered here because this is where
  // its state lives. Their chords used to be a `keydown` listener of their own.
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
        execute: openCommands,
      },
      {
        id: 'palette:open-files',
        label: 'Go to File',
        category: 'View',
        scope: 'app',
        keys: ['Mod-Shift-o', 'Ctrl-Shift-o'],
        execute: openFiles,
      },
    ],
    [openCommands, openFiles]
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
        closePalette();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPaletteOpen, closePalette]);

  // Clicking away dismisses, as Escape does. The palette renders inside .searchArea, as does
  // the button that opens it, so one containment check covers both: a click on the button falls
  // through to its own toggle instead of being closed and reopened.
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
      closePalette();
    };

    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isPaletteOpen, closePalette]);

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
          <button className="openCommandPaletteButton" onClick={openFiles}>
            Search files and commands
          </button>
        </div>
        {/* Keyed by the starting query, so a chord pressed while the palette is already open
            refills the field rather than leaving what was typed there. */}
        {paletteQuery !== null && (
          <Palette
            key={paletteQuery}
            commands={commands}
            initialQuery={paletteQuery}
            onClose={closePalette}
          />
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
