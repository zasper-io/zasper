import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './Topbar.scss';
import Palette, { COMMANDS_ONLY, LINES_ONLY } from './palette/Palette';
import { useAtom, useAtomValue } from 'jotai';
import { fileFormatsAtom } from '@/store/editorStatus';
import { userNameAtom } from '@/store/serverInfo';
import { activeTabPathAtom } from '@/store/tabState';
import { useNavigate } from 'react-router-dom';

import { logApiError, logout as signOut } from '@/api';
import { markSignedOut } from '@/auth/signedIn';
import { formatChord, isMac, terminalHasFocus } from '@/commands/keys';
import { useCommands, useRegisterCommands } from '@/commands/registry';
import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import { Command } from '@/commands/types';
import { PALETTE_COMMANDS, SEARCH_CHORD } from './paletteCommands';

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
  const openLine = useCallback(() => togglePalette(LINES_ONLY), [togglePalette]);

  // Go to Line is offered only with a text file in front, which is what has lines to go to.
  const activePath = useAtomValue(activeTabPathAtom);
  const formats = useAtomValue(fileFormatsAtom);
  const hasTextEditor = formats[activePath] !== undefined;

  // Both ways into the palette are commands like any other, registered here because this is where
  // its state lives. Their chords used to be a `keydown` listener of their own.
  const paletteCommands = useMemo<Command[]>(
    () => [
      {
        ...PALETTE_COMMANDS['palette:open'],
        // Off mac this is Ctrl-K, which a shell reads as kill-line.
        isEnabled: () => isMac || !terminalHasFocus(),
        execute: openFiles,
      },
      { ...PALETTE_COMMANDS['palette:open-commands'], execute: openCommands },
      { ...PALETTE_COMMANDS['palette:open-files'], execute: openFiles },
      {
        ...PALETTE_COMMANDS['palette:go-to-line'],
        isEnabled: () => hasTextEditor,
        execute: openLine,
      },
    ],
    [openCommands, openFiles, openLine, hasTextEditor]
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
        <IconButton
          icon="panel-left"
          className="on-chrome"
          label="Toggle sidebar"
          expanded={sidebarOpen}
          onClick={onToggleSidebar}
        />
        <span className="userName">{userName}</span>
        <LogoutButton />
      </div>
    </div>
  );
}

const LogoutButton = () => {
  const navigate = useNavigate();

  // Revoked on the server, so the session stops working wherever a copy of it is held. The page goes
  // to /login even when that fails, since a server that cannot be reached is not keeping anyone in.
  const logout = () => {
    signOut()
      .catch(logApiError('Error signing out:'))
      .finally(() => {
        markSignedOut();
        navigate('/login');
      });
  };

  return <IconButton icon="log-out" className="on-chrome" label="Sign out" onClick={logout} />;
};
