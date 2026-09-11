import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './Topbar.scss';
import Palette, { COMMANDS_ONLY } from './palette/Palette';
import { useAtom } from 'jotai';
import { protectedStateAtom, userNameAtom } from '@/store/AppState';
import { useNavigate } from 'react-router-dom';

import { formatChord, isMac, terminalHasFocus } from '@/commands/keys';
import { useCommands, useRegisterCommands } from '@/commands/registry';
import { Icon } from '@/ide/icons';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import { ICommand } from '@/commands/types';

const SEARCH_CHORD = 'Mod-k';

interface TopbarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function Topbar({ sidebarOpen, onToggleSidebar }: TopbarProps) {
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
        id: 'palette:open',
        label: 'Search Files and Commands',
        category: 'View',
        scope: 'app',
        keys: [SEARCH_CHORD],
        // Off mac this is Ctrl-K, which a shell reads as kill-line.
        isEnabled: () => isMac || !terminalHasFocus(),
        execute: openFiles,
      },
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

  // The palette is not a question either, so it dismisses both ways — and Escape stays a dismissal
  // rather than becoming a command, because it has to work while the palette's own input has focus.
  //
  // The containment check is `.searchArea` and not the palette itself: the button that opens it is in
  // there too, so a press on that falls through to its own toggle instead of being closed and reopened.
  useDismissOnEscape(closePalette, isPaletteOpen);
  useDismissOnPressOutside(searchAreaRef, closePalette, isPaletteOpen);

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
          <button
            className="openCommandPaletteButton"
            onClick={openFiles}
            aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
          >
            Search files, or run a command
            <span className="hint" aria-hidden="true">
              {formatChord(SEARCH_CHORD)}
            </span>
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
        <Icon name="search" size={14} className="searchIcon" />
      </div>
      <div className="topBar-side topBar-side-end">
        <button
          className="z-icon-button on-chrome"
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          aria-expanded={sidebarOpen}
        >
          <Icon name="panel-left" />
        </button>
        <span className="userName">{userName}</span>
        {protectedState ? <LogoutButton /> : null}
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
    <button
      className="z-icon-button on-chrome"
      onClick={logout}
      title="Log out"
      aria-label="Log out"
    >
      <Icon name="log-out" />
    </button>
  );
};
