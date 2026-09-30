/**
 * What NotebookEditor's tests put behind '@/api', uuid, CodeMirror and WebSocket. Nothing here imports the
 * app: a mock factory that imported a module importing what it mocks would wait on itself.
 */
import { vi } from 'vitest';

export const getNotebook = vi.fn();
export const sessionForPath = vi.fn();
export const createSession = vi.fn();
export const deleteSession = vi.fn();
export const saveNotebook = vi.fn();

export async function apiModule() {
  const client = await import('@/api/client');
  return {
    // Not stubbed: the real one only builds a URL, and the socket it is handed to is mocked anyway.
    websocketUrl: client.websocketUrl,
    getNotebook: (path: string) => getNotebook(path),
    sessionForPath: (path: string) => sessionForPath(path),
    createSession: (path: string, name: string, type: string, kernelspec: string) =>
      createSession(path, name, type, kernelspec),
    deleteSession: (id: string) => deleteSession(id),
    interruptKernel: vi.fn(),
    saveNotebook: (path: string, notebook: unknown) => saveNotebook(path, notebook),
    // Not stubbed: what it extracts from a failed request is what the load-error banner shows.
    apiErrorMessage: client.apiErrorMessage,
    logApiError: () => () => {},
  };
}

// Every kernel request is sent under a fresh msg_id, and a cell the file gave no id gets one, both from
// uuid — made predictable here.
let counter = 0;
export const nextId = () => `generated-cell-${++counter}`;
export const resetIds = () => {
  counter = 0;
};

export interface RecordedSocket {
  url: string;
  sent: string[];
  opened: boolean;
  closed: boolean;
  receive: (message: any) => void;
}

/** The fake sockets the editor has opened, so tests can push kernel messages. */
export const sockets: RecordedSocket[] = [];

export class FakeSocket {
  // The code under test compares readyState against WebSocket.OPEN, which is this class now.
  static OPEN = 1;

  // Off for a test that has to hold the socket unopened, rather than race the timer below.
  static autoOpen = true;

  readyState = 1; // WebSocket.OPEN
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  opened = false;
  closed = false;

  constructor(readonly url: string) {
    if (url.includes('/channels')) {
      sockets.push(this);
    }
    if (FakeSocket.autoOpen) {
      setTimeout(() => {
        this.opened = true;
        this.onopen?.();
      }, 0);
    }
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.closed = true;
  }

  receive(message: any) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

/**
 * CodeMirror cannot mount under jsdom (its CJS build loads a second copy of @codemirror/state, breaking
 * instanceof checks), and the editor surface is not what these tests exercise, so cells render a plain
 * textarea instead.
 */
export async function codeMirrorModule() {
  const react = await import('react');
  return {
    default: (props: { value?: string }) =>
      react.createElement('textarea', { value: props.value, readOnly: true }),
    Prec: { highest: (extension: unknown) => extension },
  };
}
