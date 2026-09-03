import { useEffect, useRef } from 'react';

import { BaseWebSocketUrl } from '@/config';

/**
 * How long events are collected before the tree is re-read. The server sends one message per
 * filesystem event, and something like `pip install` sends thousands, so a refresh per message would
 * be a refresh per file written.
 */
const COLLECT_MS = 500;

const RECONNECT_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * Re-reads the tree when the project directory changes underneath it — a file written by a terminal,
 * a package installed, a branch checked out. The server has been sending these events since before
 * anything listened for them: /api/contents/watch answers with the string 'reload' and nothing else,
 * so the message says only that something changed, never what.
 */
export function useContentWatcher(onChange: () => void): void {
  // The callback closes over what is currently open, so it is a new function on every render, while
  // the socket must outlive them all.
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let collect: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let opened = 0;
    let unmounted = false;

    const connect = () => {
      socket = new WebSocket(`${BaseWebSocketUrl}/api/contents/watch`);

      socket.onopen = () => {
        attempt = 0;
        opened += 1;
        // Anything that happened while the socket was down went unreported, so a reconnect cannot
        // trust what is on screen. The first open is the panel's own initial read.
        if (opened > 1) {
          latest.current();
        }
      };

      socket.onmessage = () => {
        if (collect === undefined) {
          collect = setTimeout(() => {
            collect = undefined;
            latest.current();
          }, COLLECT_MS);
        }
      };

      socket.onclose = () => {
        if (unmounted) {
          return;
        }
        // The server is down or restarting; retrying in a tight loop helps nobody.
        attempt += 1;
        retry = setTimeout(connect, Math.min(RECONNECT_MAX_MS, RECONNECT_MS * 2 ** (attempt - 1)));
      };
    };

    connect();

    return () => {
      unmounted = true;
      clearTimeout(collect);
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
}
