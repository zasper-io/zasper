import React, { useEffect, useRef, useMemo } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AttachAddon } from '@xterm/addon-attach';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SerializeAddon } from '@xterm/addon-serialize';

import '@xterm/xterm/css/xterm.css';
import './xterm.css';
import { BaseWebSocketUrl } from '../config';
import { useAtom } from 'jotai';
import { themeAtom } from '../../store/Settings';

export default function TerminalTab(props) {
  const [theme] = useAtom(themeAtom);
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

  useEffect(() => {
    if (terminalRef.current == null) return;

    const xtemBackground = theme === 'light' ? '#392e6b' : '#2b2a2a';
    // Initialize the terminal
    const terminal = new XTerm({
      theme: {
        background: xtemBackground,
      },
      fontFamily: 'Monospace',
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

    socketRef.current = new WebSocket(BaseWebSocketUrl + '/api/terminals/1');

    socketRef.current.onopen = () => {
      if (socketRef.current !== null) {
        const attachAddon = new AttachAddon(socketRef.current);
        terminal.loadAddon(attachAddon);
        fitAddon.fit();
      }
    };

    window.addEventListener('resize', () => {
      fitAddon.fit();
    });

    return () => {
      // Clean up on component unmount
      socketRef.current?.close();
      terminal.dispose();

      window.removeEventListener('resize', () => {
        fitAddon.fit();
      });
    };
  }, [theme, fitAddon, serializeAddon, unicode11Addon, webLinksAddon]);

  return (
    <div className="tab-content">
      <div className="terminalContainer">
        <div ref={terminalRef} className="terminalArea" />
      </div>
    </div>
  );
}
