import { Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import {
  formatKeymap,
  hoverTooltips,
  jumpToDefinitionKeymap,
  LSPClient,
  LSPPlugin,
  serverCompletion,
  serverDiagnostics,
  signatureHelp,
} from '@codemirror/lsp-client';
import { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

import { websocketUrl } from '@/api/client';
import { Problem, ServerStatus, Severity } from '@/store/languageServers';
import { fileUri, pathOfUri, serverLanguageFor } from './languages';
import { sanitizeHtml } from './sanitize';
import { versionOf } from './serverInfo';
import {
  CLOSE_EXITED,
  CLOSE_NOT_INSTALLED,
  CLOSE_TURNED_OFF,
  openSocketTransport,
  SocketTransport,
} from './transport';
import { ZasperWorkspace } from './workspace';

/** How long a server is kept once its language's last file has closed. */
export const IDLE_STOP = 60_000;
/** How often a server that crashed is started again before it is called failed. */
const RETRIES = 3;

export interface LanguageServerEvents {
  status: (server: string, status: ServerStatus) => void;
  problems: (path: string, problems: Problem[]) => void;
  /** A warning or an error a server asked to show the reader, which the app raises as a toast. */
  message: (server: string, kind: 'error' | 'warning', text: string) => void;
}

type Listener = Partial<LanguageServerEvents>;

interface Connection {
  server: string;
  root: string;
  client: LSPClient;
  status: ServerStatus;
  transport: SocketTransport | null;
  retries: number;
  idleTimer: number | undefined;
  retryTimer: number | undefined;
  /** Set while a close is ours — Stop, or idle — so it is not mistaken for a crash. */
  closing: boolean;
  /** The files this server has published problems for, to clear when it goes. */
  paths: Set<string>;
}

const connections = new Map<string, Connection>();
const listeners = new Set<Listener>();
const problems = new Map<string, Problem[]>();
let display: (path: string) => Promise<EditorView | null> = () => Promise.resolve(null);

/** Hears every status change and every file's problems, starting with where each stands now. */
export function subscribeLanguageServers(listener: Listener): () => void {
  listeners.add(listener);
  connections.forEach((connection) => listener.status?.(connection.server, connection.status));
  problems.forEach((list, path) => listener.problems?.(path, list));
  return () => {
    listeners.delete(listener);
  };
}

/** How a jump into another file puts that file in front of the reader. */
export function setDisplayFile(open: (path: string) => Promise<EditorView | null>): void {
  display = open;
}

function setStatus(connection: Connection, status: ServerStatus): void {
  connection.status = status;
  listeners.forEach((listener) => listener.status?.(connection.server, status));
}

function setProblems(connection: Connection, path: string, list: Problem[]): void {
  if (list.length === 0) {
    problems.delete(path);
    connection.paths.delete(path);
  } else {
    problems.set(path, list);
    connection.paths.add(path);
  }
  listeners.forEach((listener) => listener.problems?.(path, list));
}

const SEVERITIES: Severity[] = ['error', 'warning', 'info', 'hint'];

interface PublishedDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
}

/**
 * A server's diagnostics for one file: recorded for the Problems panel and the counts, whether or not the
 * file is open, and drawn in its editor when it is — with where each came from, which the library's own
 * handler leaves out and the card shows.
 */
function publishDiagnostics(
  connection: Connection,
  params: { uri: string; version?: number; diagnostics: PublishedDiagnostic[] }
): boolean {
  const path = pathOfUri(connection.root, params.uri);
  if (path !== null) {
    setProblems(
      connection,
      path,
      params.diagnostics.map((item) => ({
        severity: SEVERITIES[(item.severity ?? 1) - 1] ?? 'error',
        message: item.message,
        source: item.source,
        code: item.code === undefined ? undefined : String(item.code),
        line: item.range.start.line,
        character: item.range.start.character,
      }))
    );
  }

  const file = connection.client.workspace.getFile(params.uri);
  if (file === null || (params.version != null && params.version !== file.version)) {
    return true;
  }
  const view = file.getView();
  const plugin = view && LSPPlugin.get(view);
  if (!view || !plugin) {
    return true;
  }
  const named = connection.status.name;
  const drawn: Diagnostic[] = [];
  for (const item of params.diagnostics) {
    try {
      const from = plugin.unsyncedChanges.mapPos(
        plugin.fromPosition(item.range.start, plugin.syncedDoc)
      );
      const to = plugin.unsyncedChanges.mapPos(
        plugin.fromPosition(item.range.end, plugin.syncedDoc)
      );
      drawn.push({
        from,
        to: Math.max(from, to),
        severity: SEVERITIES[(item.severity ?? 1) - 1] ?? 'error',
        message: item.message,
        source: [item.source, named].filter(Boolean).join(' · ') || undefined,
      });
    } catch {
      // A range past the end of a document the server has not caught up with.
    }
  }
  view.dispatch(setDiagnostics(view.state, drawn));
  return true;
}

function clearProblems(connection: Connection): void {
  [...connection.paths].forEach((path) => setProblems(connection, path, []));
}

function connectionFor(server: string, root: string): Connection {
  const known = connections.get(server);
  if (known !== undefined && known.root === root) {
    return known;
  }
  const connection: Connection = {
    server,
    root,
    client: null as unknown as LSPClient,
    status: { state: 'starting', name: '' },
    transport: null,
    retries: 0,
    idleTimer: undefined,
    retryTimer: undefined,
    closing: false,
    paths: new Set(),
  };
  connection.client = new LSPClient({
    rootUri: fileUri(root, '').replace(/\/$/, ''),
    timeout: 10_000,
    sanitizeHTML: sanitizeHtml,
    workspace: (client) =>
      new ZasperWorkspace(client, {
        opened: () => {
          window.clearTimeout(connection.idleTimer);
          void connect(connection);
        },
        emptied: () => {
          window.clearTimeout(connection.idleTimer);
          connection.idleTimer = window.setTimeout(() => stop(connection), IDLE_STOP);
        },
        display: (uri) => {
          const path = pathOfUri(root, uri);
          return path === null ? Promise.resolve(null) : display(path);
        },
      }),
    notificationHandlers: {
      'textDocument/publishDiagnostics': (_client, params) =>
        publishDiagnostics(connection, params),
      // The client draws these as a CodeMirror panel across the top of the editor, with an OK button, for
      // messages as routine as "Finished loading packages". A warning or an error is worth a toast; the
      // rest is the server talking to itself.
      'window/showMessage': (_client, params: { type: number; message: string }) => {
        if (params.type === 1 || params.type === 2) {
          const kind = params.type === 1 ? 'error' : 'warning';
          listeners.forEach((listener) => listener.message?.(server, kind, params.message));
        }
        return true;
      },
      'window/logMessage': () => true,
    },
    extensions: [
      serverCompletion(),
      hoverTooltips(),
      signatureHelp(),
      serverDiagnostics(),
      keymap.of([...jumpToDefinitionKeymap, ...formatKeymap]),
    ],
  });
  connections.set(server, connection);
  return connection;
}

async function connect(connection: Connection): Promise<void> {
  if (connection.transport !== null || connection.retryTimer !== undefined) {
    return;
  }
  connection.closing = false;
  setStatus(connection, { ...connection.status, state: 'starting', message: undefined });
  let transport: SocketTransport;
  try {
    transport = await openSocketTransport(
      websocketUrl(`/ws/lsp/${encodeURIComponent(connection.server)}`),
      (code, reason) => closed(connection, transport, code, reason)
    );
  } catch {
    // The close handler has already said why.
    return;
  }
  connection.transport = transport;
  // The server names itself in its answer to `initialize`, which the client does not keep.
  const hearName = (message: string) => {
    const info = (
      JSON.parse(message) as { result?: { serverInfo?: { name: string; version?: string } } }
    ).result?.serverInfo;
    if (info !== undefined) {
      connection.status = {
        ...connection.status,
        name: info.name,
        version: versionOf(info.version),
      };
      transport.unsubscribe(hearName);
    }
  };
  transport.subscribe(hearName);
  connection.client.connect(transport);
  try {
    await connection.client.initializing;
    connection.retries = 0;
    setStatus(connection, { ...connection.status, state: 'ready', message: undefined });
  } catch (error) {
    setStatus(connection, {
      ...connection.status,
      state: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
    transport.close();
  }
}

function closed(
  connection: Connection,
  transport: SocketTransport | undefined,
  code: number,
  reason: string
): void {
  if (transport !== undefined && connection.transport !== transport) {
    return;
  }
  connection.transport = null;
  connection.client.disconnect();
  clearProblems(connection);

  if (connection.closing) {
    setStatus(connection, { ...connection.status, state: 'off', message: undefined });
    return;
  }
  if (code === CLOSE_TURNED_OFF) {
    setStatus(connection, { ...connection.status, state: 'off', message: reason });
    return;
  }
  if (code === CLOSE_NOT_INSTALLED) {
    setStatus(connection, { ...connection.status, state: 'missing', message: reason });
    return;
  }
  const open = connection.client.workspace.files.length > 0;
  if (open && connection.retries < RETRIES) {
    const wait = 1000 * 2 ** connection.retries;
    connection.retries += 1;
    setStatus(connection, { ...connection.status, state: 'starting', message: reason });
    connection.retryTimer = window.setTimeout(() => {
      connection.retryTimer = undefined;
      void connect(connection);
    }, wait);
    return;
  }
  setStatus(connection, {
    ...connection.status,
    state: 'failed',
    message: reason || (code === CLOSE_EXITED ? 'The server exited.' : 'The connection was lost.'),
  });
}

function stop(connection: Connection): void {
  window.clearTimeout(connection.retryTimer);
  connection.retryTimer = undefined;
  connection.closing = true;
  if (connection.transport !== null) {
    connection.transport.close();
  } else {
    setStatus(connection, { ...connection.status, state: 'off' });
  }
}

/**
 * What a file editor adds for a language server: the plugin that opens the file with the server, and the
 * gutter its problems are marked in. Nothing for a file no server Zasper knows serves.
 */
export function languageServerExtension(root: string, path: string, fileName: string): Extension {
  const language = serverLanguageFor(fileName);
  if (language === null || root === '') {
    return [];
  }
  const connection = connectionFor(language.server, root);
  return [connection.client.plugin(fileUri(root, path), language.languageId), lintGutter()];
}

/** Stops a server and starts it again, forgetting any crashes that led here. */
export function restartLanguageServer(server: string): void {
  const connection = connections.get(server);
  if (connection === undefined) {
    return;
  }
  connection.retries = 0;
  if (connection.transport === null) {
    window.clearTimeout(connection.retryTimer);
    connection.retryTimer = undefined;
    void connect(connection);
    return;
  }
  const transport = connection.transport;
  connection.closing = true;
  transport.close();
  // Started again once the close has landed, which clears the transport.
  const wait = window.setInterval(() => {
    if (connection.transport === null) {
      window.clearInterval(wait);
      void connect(connection);
    }
  }, 50);
}

export function stopLanguageServer(server: string): void {
  const connection = connections.get(server);
  if (connection !== undefined) {
    stop(connection);
  }
}

/** Forgets every connection, for tests. */
export function resetLanguageServers(): void {
  connections.forEach((connection) => {
    window.clearTimeout(connection.idleTimer);
    window.clearTimeout(connection.retryTimer);
    connection.transport?.close();
  });
  connections.clear();
  problems.clear();
  listeners.clear();
}
