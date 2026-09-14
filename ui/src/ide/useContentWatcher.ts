import { useEffect, useRef } from 'react';

import { websocketUrl } from '@/api';

/**
 * How long events are collected before a listener is told. The server sends one message per filesystem
 * event, and something like `pip install` sends thousands, so a refresh per message would be a refresh
 * per file written.
 */
const COLLECT_MS = 500;

const RECONNECT_MS = 1000;
const RECONNECT_MAX_MS = 30000;

interface Listener {
  changed: () => void;
  collect?: ReturnType<typeof setTimeout>;
}

/*
 * One socket for everyone listening. The file browser, the git panel and every open file each held one
 * of their own, and all of them carry the same message.
 */
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let opened = 0;

function collect(listener: Listener): void {
  if (listener.collect === undefined) {
    listener.collect = setTimeout(() => {
      listener.collect = undefined;
      listener.changed();
    }, COLLECT_MS);
  }
}

function connect(): void {
  retry = undefined;
  const current = new WebSocket(websocketUrl('/api/contents/watch'));
  socket = current;

  current.onopen = () => {
    attempt = 0;
    opened += 1;
    // Anything that happened while the socket was down went unreported, so a reconnect cannot trust
    // what is on screen. The first open comes with each listener's own initial read.
    if (opened > 1) {
      listeners.forEach((listener) => listener.changed());
    }
  };

  current.onmessage = () => listeners.forEach(collect);

  current.onclose = () => {
    // Closed on purpose, because nobody is listening any more.
    if (socket !== current) {
      return;
    }
    socket = null;
    // The server is down or restarting; retrying in a tight loop helps nobody.
    attempt += 1;
    retry = setTimeout(connect, Math.min(RECONNECT_MAX_MS, RECONNECT_MS * 2 ** (attempt - 1)));
  };
}

function listen(listener: Listener): () => void {
  listeners.add(listener);
  if (socket === null && retry === undefined) {
    connect();
  }

  return () => {
    listeners.delete(listener);
    clearTimeout(listener.collect);
    if (listeners.size > 0) {
      return;
    }
    clearTimeout(retry);
    retry = undefined;
    const closing = socket;
    socket = null;
    attempt = 0;
    opened = 0;
    closing?.close();
  };
}

/**
 * Calls `onChange` when the project directory changes underneath the app — a file written by a
 * terminal, a package installed, a branch checked out. /api/contents/watch answers with the string
 * 'reload' and nothing else, so the message says only that something changed, never what.
 */
export function useContentWatcher(onChange: () => void): void {
  // The callback closes over what is currently open, so it is a new function on every render, while
  // the listener must outlive them all.
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => listen({ changed: () => latest.current() }), []);
}
