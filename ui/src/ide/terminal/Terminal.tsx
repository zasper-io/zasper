import React, { useEffect, useRef, useMemo } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AttachAddon } from '@xterm/addon-attach';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SerializeAddon } from '@xterm/addon-serialize';

import '@xterm/xterm/css/xterm.css';
import './xterm.css';
import { BaseWebSocketUrl } from '@/config';
import { IfileTab } from '@/store/TabState';
import { terminalTheme } from './theme';

interface TerminalTabProps {
  data: IfileTab;
}

export default function TerminalTab({ data }: TerminalTabProps) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const fitAddon = useMemo(() => new FitAddon(), []);
  const webLinksAddon = useMemo(() => new WebLinksAddon(), []);
  const unicode11Addon = useMemo(() => new Unicode11Addon(), []);
  const serializeAddon = useMemo(() => new SerializeAddon(), []);

  const sendSizeToBackend = (colsInput: number, rowsInput: number) => {
    // Send the set_size message to the backend with the terminal dimensions
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      let rows = rowsInput;
      let cols = colsInput;
      let size = JSON.stringify({ cols: cols, rows: rows + 1 });
      let send = new TextEncoder().encode('\x01' + size);
      socketRef.current.send(send);
    }
  };

  const terminalId = data.name;
  // A terminal opened from a folder in the file browser starts there; the server falls back to the
  // project root for anything it cannot use.
  const cwd = data.cwd ?? '';

  useEffect(() => {
    if (terminalRef.current == null) return;

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
      allowProposedApi: true,
    });

    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.loadAddon(serializeAddon);

    fitAddon.fit();

    // Attach terminal to DOM
    terminal.open(terminalRef.current);
    terminal.focus();

    // Handle resize events
    terminal.onResize(({ cols, rows }) => {
      sendSizeToBackend(cols, rows); // Send new size on resize
    });

    const query = cwd === '' ? '' : `?cwd=${encodeURIComponent(cwd)}`;
    socketRef.current = new WebSocket(
      `${BaseWebSocketUrl}/ws/terminals/${encodeURIComponent(terminalId)}${query}`
    );

    socketRef.current.onopen = () => {
      if (socketRef.current !== null) {
        const attachAddon = new AttachAddon(socketRef.current);
        terminal.loadAddon(attachAddon);
        fitAddon.fit();
      }
    };

    const refit = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', refit);

    return () => {
      // Clean up on component unmount
      socketRef.current?.close();
      terminal.dispose();

      window.removeEventListener('resize', refit);
    };
  }, [terminalId, cwd, fitAddon, serializeAddon, unicode11Addon, webLinksAddon]);

  return (
    <div className="tab-content">
      <div className="terminalContainer">
        <div ref={terminalRef} className="terminalArea" />
      </div>
    </div>
  );
}
