import { useEffect, useRef } from 'react';

import { websocketUrl } from '@/api';
import { checkServer, serverAnswered, watchServer } from './serverConnection';

/**
 * How long changes are collected before a listener is told. Something like `pip install` changes
 * thousands of files, so a refresh per message would be a refresh per file written.
 */
const COLLECT_MS = 500;

const RECONNECT_MS = 1000;
const RECONNECT_MAX_MS = 30000;

interface Listener {
  /** Told of a change to this file only, with its hash; every change when absent. */
  path?: string;
  /**
   * `hash` is what the file now holds, `''` when it is gone, and undefined when it is not known. `by` is
   * who wrote it, when they wrote it through Zasper and named themselves.
   */
  changed: (hash?: string, by?: string) => void;
  collect?: ReturnType<typeof setTimeout>;
  /** The last change heard while collecting, so the listener is told of the latest version. */
  hash?: string;
  by?: string;
}

/** What the server sends for a change; a bare `reload` says to read everything again. */
interface ChangeMessage {
  changed: { path: string; hash?: string; by?: string }[];
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
let stopWatchingServer: (() => void) | undefined;

function collect(listener: Listener, hash?: string, by?: string): void {
  listener.hash = hash;
  listener.by = by;
  if (listener.collect === undefined) {
    listener.collect = setTimeout(() => {
      listener.collect = undefined;
      listener.changed(listener.hash, listener.by);
    }, COLLECT_MS);
  }
}

/** The project-relative spelling the server uses, whatever a tab calls its file. */
function normalise(path: string): string {
  return path.replace(/^(\.\/|\/)+/, '');
}

/** Tells the server which files are open, so it reports them wherever they are and with their hash. */
function sendWatched(): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }
  const paths = new Set<string>();
  listeners.forEach((listener) => {
    if (listener.path !== undefined) {
      paths.add(listener.path);
    }
  });
  socket.send(JSON.stringify({ watch: [...paths] }));
}

function parse(data: unknown): ChangeMessage | null {
  if (typeof data !== 'string' || data === 'reload') {
    return null;
  }
  try {
    const message = JSON.parse(data) as ChangeMessage;
    return Array.isArray(message.changed) ? message : null;
  } catch {
    return null;
  }
}

function receive(event: MessageEvent): void {
  const message = parse(event.data);
  if (message === null) {
    listeners.forEach((listener) => collect(listener));
    return;
  }
  const changes = new Map(message.changed.map((change) => [change.path, change]));
  listeners.forEach((listener) => {
    if (listener.path === undefined) {
      collect(listener);
    } else {
      const change = changes.get(listener.path);
      if (change !== undefined) {
        collect(listener, change.hash, change.by);
      }
    }
  });
}

function connect(): void {
  retry = undefined;
  const current = new WebSocket(websocketUrl('/api/contents/watch'));
  socket = current;

  current.onopen = () => {
    attempt = 0;
    opened += 1;
    serverAnswered();
    sendWatched();
    // Anything that happened while the socket was down went unreported, so a reconnect cannot trust
    // what is on screen. The first open comes with each listener's own initial read.
    if (opened > 1) {
      listeners.forEach((listener) => listener.changed());
    }
  };

  current.onmessage = receive;

  current.onclose = () => {
    // Closed on purpose, because nobody is listening any more.
    if (socket !== current) {
      return;
    }
    socket = null;
    // The server is down or restarting; retrying in a tight loop helps nobody.
    attempt += 1;
    retry = setTimeout(connect, Math.min(RECONNECT_MAX_MS, RECONNECT_MS * 2 ** (attempt - 1)));
    void checkServer();
  };
}

// Back as soon as the server is, rather than at the end of a backoff that may have reached 30s.
function reconnectWhenBack(offline: boolean): void {
  if (!offline && socket === null && retry !== undefined) {
    clearTimeout(retry);
    connect();
  }
}

function listen(listener: Listener): () => void {
  listeners.add(listener);
  if (socket === null && retry === undefined) {
    connect();
    stopWatchingServer = watchServer(reconnectWhenBack);
  } else if (listener.path !== undefined) {
    sendWatched();
  }

  return () => {
    listeners.delete(listener);
    clearTimeout(listener.collect);
    if (listeners.size > 0) {
      if (listener.path !== undefined) {
        sendWatched();
      }
      return;
    }
    clearTimeout(retry);
    retry = undefined;
    stopWatchingServer?.();
    stopWatchingServer = undefined;
    const closing = socket;
    socket = null;
    attempt = 0;
    opened = 0;
    closing?.close();
  };
}

/**
 * Calls `onChange` when the project directory changes underneath the app — a file written by a
 * terminal, a package installed, a branch checked out — whatever changed.
 */
export function useContentWatcher(onChange: () => void): void {
  // The callback closes over what is currently open, so it is a new function on every render, while
  // the listener must outlive them all.
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => listen({ changed: () => latest.current() }), []);
}

/**
 * Calls `onChange` when the file at `path` changes on disk, with the hash it now holds, so an editor that
 * already holds that version need not read it again. The file is watched even in a folder the project's
 * watch leaves out, such as one `.gitignore` ignores. The hash is undefined when the change is not known
 * to be this file's alone — a reconnect, or more changes than the server lists — and the file should be
 * read again.
 */
export function useFileWatcher(path: string, onChange: (hash?: string, by?: string) => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(
    () => listen({ path: normalise(path), changed: (hash, by) => latest.current(hash, by) }),
    [path]
  );
}
