import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AttachAddon } from '@xterm/addon-attach';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SerializeAddon } from '@xterm/addon-serialize';

import '@xterm/xterm/css/xterm.css';
import './xterm.css';
import { websocketUrl } from '@/api';
import { APP_COMMANDS } from '@/commands/appCommands';
import { chordMatches } from '@/commands/keys';
import { terminalInputAtom } from '@/store/terminals';
import { terminalTheme } from './theme';

interface TerminalViewProps {
  /** The shell's name, which is what the server knows it by. */
  id: string;
  /** Where it was started, for a shell opened from a folder in the tree. */
  cwd?: string;
}

// The size the canvas is drawn at, read off the element like the family and the sixteen colours are.
// `undefined` rather than a number of its own when there is no stylesheet — a jsdom test — because a
// NaN here is xterm's default 15, which is where the terminal not matching the code's size came from.
const cellFontSize = (element: HTMLElement): number | undefined => {
  const size = parseFloat(getComputedStyle(element).fontSize);
  return Number.isNaN(size) ? undefined : size;
};

export default function TerminalView({ id, cwd }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<XTerm | null>(null);

  const fitAddon = useMemo(() => new FitAddon(), []);
  const webLinksAddon = useMemo(() => new WebLinksAddon(), []);
  const unicode11Addon = useMemo(() => new Unicode11Addon(), []);
  const serializeAddon = useMemo(() => new SerializeAddon(), []);

  // The PTY starts at the library's default 80x24, so the size has to go out even when a fit changed
  // nothing. `rows` is sent as it is: one more would tell the shell it has a line xterm does not
  // draw, and a pager or a status line would paint into a row that does not exist.
  const sendSizeToBackend = (cols: number, rows: number) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const size = JSON.stringify({ cols: cols, rows: rows });
      socketRef.current.send(new TextEncoder().encode('\x01' + size));
    }
  };

  const terminalId = id;
  // A terminal opened from a folder in the file browser starts there; the server falls back to the
  // project root for anything it cannot use.
  const startIn = cwd ?? '';

  // Nothing is opened until the fonts have settled. xterm measures one character when it opens and
  // never again on its own, and JetBrains Mono arrives from Google Fonts with `display=swap`: measure
  // before it lands and the cell is the fallback's 18px for a font that draws at 20, so the next fit
  // divides the pane by a height nothing is drawn at and hands back more rows than fit. `fonts.ready`
  // resolves either way — a font that fails to load still settles — and by the time anyone opens a
  // terminal it has usually resolved already.
  const [fontsReady, setFontsReady] = useState(false);
  // Not when the socket opens but when the shell has drawn its prompt and gone quiet: a line that
  // arrives before that is echoed by the tty and then again by the shell's own line editor.
  const [promptReady, setPromptReady] = useState(false);
  const [pendingInput, setPendingInput] = useAtom(terminalInputAtom);
  const waiting = pendingInput[id];
  useEffect(() => {
    let live = true;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (live) setFontsReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  // Never fit an element that has no layout box. Every tab stays mounted and an inactive one is
  // `display: none`, and FitAddon measures its parent with getComputedStyle: with no layout that
  // answers `100%`, which parseInt reads as 100 pixels. So one window resize behind another tab
  // collapsed the terminal to 5 rows by 9 columns for good, and a single `ls` then had scrollback —
  // which is the scrollbar that turned up in a terminal nobody had scrolled.
  const refit = useCallback(() => {
    if (terminalRef.current === null || terminalRef.current.clientHeight === 0) return;
    fitAddon.fit();
  }, [fitAddon]);

  useEffect(() => {
    if (terminalRef.current == null || !fontsReady) return;

    // xterm draws to a canvas, so it wants strings and not custom properties: everything below is read
    // off this element rather than restated here. Custom properties inherit, so the sixteen ANSI
    // colours come from the `.terminalContainer` scope around it and the rest from `:root`.
    //
    // Whitespace is collapsed because the mono declaration wraps in _tokens.scss and xterm builds a
    // canvas font string out of it. The fallback is for a jsdom test, where no stylesheet is loaded.
    const style = getComputedStyle(terminalRef.current);
    const mono =
      style.getPropertyValue('--z-mono-font-family').replace(/\s+/g, ' ').trim() || 'monospace';

    const terminal = new XTerm({
      theme: terminalTheme(style),
      allowTransparency: true,
      fontFamily: mono,
      fontSize: cellFontSize(terminalRef.current),
      allowProposedApi: true,
    });
    xtermRef.current = terminal;

    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.loadAddon(serializeAddon);

    // Attach terminal to DOM
    terminal.open(terminalRef.current);
    terminal.focus();
    // The toggle is a chord the window takes even here, so xterm must not also send it to the shell.
    terminal.attachCustomKeyEventHandler(
      (event) => !(APP_COMMANDS['view:terminal'].keys ?? []).some((key) => chordMatches(key, event))
    );

    // Handle resize events
    terminal.onResize(({ cols, rows }) => {
      sendSizeToBackend(cols, rows); // Send new size on resize
    });

    socketRef.current = new WebSocket(
      websocketUrl(`/ws/terminals/${encodeURIComponent(terminalId)}`, {
        cwd: startIn === '' ? undefined : startIn,
      })
    );

    socketRef.current.onopen = () => {
      if (socketRef.current !== null) {
        const attachAddon = new AttachAddon(socketRef.current);
        terminal.loadAddon(attachAddon);
        // Through refit, not fitAddon.fit(): the socket can open after the tab has been switched
        // away from, and a fit then is the five-row collapse described above.
        refit();
        sendSizeToBackend(terminal.cols, terminal.rows);
      }
    };

    let quiet: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        setPromptReady(true);
        socketRef.current?.removeEventListener('message', settle);
      }, 200);
    };
    socketRef.current.addEventListener('message', settle);

    // A ResizeObserver rather than `window.resize`: it also catches the sidebar opening, the tab
    // coming back after a resize it missed, and a browser zoom. Firing once on observe is the first fit.
    const observer = new ResizeObserver(refit);
    observer.observe(terminalRef.current);

    return () => {
      clearTimeout(quiet);
      setPromptReady(false);
      // Clean up on component unmount
      socketRef.current?.close();
      terminal.dispose();
      xtermRef.current = null;

      observer.disconnect();
    };
  }, [
    terminalId,
    startIn,
    fontsReady,
    refit,
    fitAddon,
    serializeAddon,
    unicode11Addon,
    webLinksAddon,
  ]);

  // Typed in as the keyboard would, once the shell is waiting for it.
  useEffect(() => {
    const socket = socketRef.current;
    if (!promptReady || waiting === undefined || socket?.readyState !== WebSocket.OPEN) return;
    waiting.forEach((line) => socket.send(line));
    setPendingInput((pending) => {
      const next = { ...pending };
      delete next[id];
      return next;
    });
  }, [promptReady, waiting, id, setPendingInput]);

  // `.tab-surface` was around this, which is the card a tab draws: in the panel under the editor it
  // was a block box between the pane and the terminal, so the height chain ended there and xterm kept
  // its default 24 rows inside a pane half that tall. The host provides the box; this is the pane.
  return (
    <div className="terminalContainer">
      <div ref={terminalRef} className="terminalArea" />
    </div>
  );
}
