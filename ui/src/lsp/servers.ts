import { Diagnostic, linter, setDiagnostics } from '@codemirror/lint';
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
import { fileUri, pathOfUri, ServerLanguage, serverLanguageFor } from './languages';
import { offsetAt } from './positions';
import { sanitizeHtml } from './sanitize';
import { versionOf } from './serverInfo';
import {
  CLOSE_EXITED,
  CLOSE_NOT_INSTALLED,
  CLOSE_TURNED_OFF,
  openSocketTransport,
  SocketTransport,
} from './transport';
import { applyWorkspaceEdit, ProtocolWorkspaceEdit } from './workspaceEdits';
import { ZasperWorkspace } from './workspace';

/*
What a server is told about how Zasper wants to be served, sent once it is ready.

Only one server needs anything so far. gopls computes no inlay hints at all unless its own `hints`
options name the kinds to compute, so "Inlay hints" in Settings would do nothing for Go however the
editor asked. Saying yes to every kind here costs nothing while the setting is off: the hints are only
ever drawn for a file the editor asks about, and it asks about none until the reader turns them on.
*/
const SERVER_OPTIONS: Record<string, unknown> = {
  go: {
    hints: {
      assignVariableTypes: true,
      compositeLiteralFields: true,
      compositeLiteralTypes: true,
      constantValues: true,
      functionTypeParameters: true,
      parameterNames: true,
      rangeVariableTypes: true,
    },
  },
};

/**
 * The `initialize` request with this server's options added to it.
 *
 * The client builds that request itself and has no way to put anything of ours in it, so it is added on
 * the way out. Sent with `initialize` rather than as a configuration change afterwards because gopls
 * answers a change by asking the client for its settings — a request the client replies "method not
 * implemented" to — and then keeps its defaults.
 */
function withOptions(message: string, options: unknown): string {
  try {
    const asked = JSON.parse(message) as { method?: string; params?: Record<string, unknown> };
    if (asked.method !== 'initialize' || asked.params === undefined) {
      return message;
    }
    asked.params.initializationOptions = options;
    return JSON.stringify(asked);
  } catch {
    return message;
  }
}

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
/** The diagnostics as the server sent them, which is what a code action request has to be given. */
const published = new Map<string, PublishedDiagnostic[]>();
let display: (path: string) => Promise<EditorView | null> = () => Promise.resolve(null);

/** What receives the diagnostics for a notebook's virtual document, by that document's URI. */
export interface NotebookHost {
  /** The notebook's own path, which its problems are recorded under. */
  path: string;
  /** Draws the diagnostics in the cells, and answers them as the notebook's problems. */
  diagnostics: (published: PublishedDiagnostic[], server: string) => Problem[];
}

const notebookHosts = new Map<string, NotebookHost>();

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

export interface PublishedDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
}

/**
 * Draws one file's diagnostics in the editor that holds it, if one does.
 *
 * The version the server answered about is deliberately not compared with the file's. The file editor
 * mounts a new CodeMirror for each read of the same file, which closes and reopens the document and so
 * moves its version on without a character changing — and a diagnostic from before that is still about
 * the text on screen. What the text *has* changed by is carried across below instead, which is the drift
 * that actually moves a squiggle.
 */
function drawDiagnostics(
  connection: Connection,
  uri: string,
  diagnostics: PublishedDiagnostic[]
): void {
  const file = connection.client.workspace.getFile(uri);
  const view = file?.getView();
  const plugin = view && LSPPlugin.get(view);
  if (!file || !view || !plugin) {
    return;
  }
  // The server's positions are in the document it was last sent; anything typed since is carried across so
  // a squiggle stays under the word it is about.
  const sent = plugin.syncedDoc;
  const since = plugin.unsyncedChanges;
  const named = connection.status.name;
  const drawn: Diagnostic[] = diagnostics.map((item) => {
    const start = since.mapPos(offsetAt(sent, item.range.start), 1);
    const end = since.mapPos(offsetAt(sent, item.range.end), -1);
    return {
      from: start,
      to: Math.max(start, end),
      severity: SEVERITIES[(item.severity ?? 1) - 1] ?? 'error',
      message: item.message,
      source: [item.source, named].filter(Boolean).join(' · ') || undefined,
    };
  });
  view.dispatch(setDiagnostics(view.state, drawn));
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
  const host = notebookHosts.get(params.uri);
  if (host !== undefined) {
    setProblems(
      connection,
      host.path,
      host.diagnostics(params.diagnostics, connection.status.name)
    );
    return true;
  }
  const path = pathOfUri(connection.root, params.uri);
  if (path !== null) {
    if (params.diagnostics.length === 0) {
      published.delete(path);
    } else {
      published.set(path, params.diagnostics);
    }
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

  drawDiagnostics(connection, params.uri, params.diagnostics);
  return true;
}

/**
 * Draws what is already known about a file the reader has only now opened.
 *
 * A server publishes a package's problems once, for every file in it, whether or not any of them has an
 * editor — so the second file opened would have had a count in the tree and no squiggle in its own text
 * until something made the server say it again. Deferred by a tick because this is called from the
 * plugin's own construction, and CodeMirror does not take a dispatch inside an update.
 */
function drawWhatIsKnown(connection: Connection, uri: string): void {
  const path = pathOfUri(connection.root, uri);
  const known = path === null ? undefined : published.get(path);
  if (known === undefined) {
    return;
  }
  window.setTimeout(() => drawDiagnostics(connection, uri, known), 0);
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
        opened: (uri) => {
          window.clearTimeout(connection.idleTimer);
          void connect(connection);
          drawWhatIsKnown(connection, uri);
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
      // What the client says it can do, beyond the library's own list: everything story 20 asks for.
      {
        clientCapabilities: {
          textDocument: {
            references: { dynamicRegistration: false },
            rename: { prepareSupport: true },
            codeAction: {
              codeActionLiteralSupport: {
                codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] },
              },
              resolveSupport: { properties: ['edit'] },
              dataSupport: true,
            },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            inlayHint: { dynamicRegistration: false },
          },
          workspace: {
            applyEdit: true,
            workspaceEdit: { documentChanges: true },
            symbol: { dynamicRegistration: false },
            executeCommand: { dynamicRegistration: false },
          },
        },
      },
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
  const options = SERVER_OPTIONS[connection.server];
  try {
    const socket = await openSocketTransport(
      websocketUrl(`/ws/lsp/${encodeURIComponent(connection.server)}`),
      (code, reason) => closed(connection, transport, code, reason)
    );
    transport =
      options === undefined
        ? socket
        : { ...socket, send: (message) => socket.send(withOptions(message, options)) };
  } catch {
    // The close handler has already said why.
    return;
  }
  connection.transport = transport;
  // A server may ask the editor to make an edit — after a quick fix it carried out itself, above all.
  // The client answers requests it does not know with "method not implemented", so this is answered
  // here, before it reaches the client at all.
  transport.intercept((message) => {
    let asked: { id?: number | string; method?: string; params?: { edit?: ProtocolWorkspaceEdit } };
    try {
      asked = JSON.parse(message);
    } catch {
      return false;
    }
    if (asked.method !== 'workspace/applyEdit' || asked.id === undefined) {
      return false;
    }
    const edit = asked.params?.edit;
    void (
      edit === undefined ? Promise.resolve(null) : applyWorkspaceEdit(connection.root, edit)
    ).then((outcome) => {
      const applied = outcome !== null && outcome.failed.length === 0;
      transport.send(JSON.stringify({ jsonrpc: '2.0', id: asked.id, result: { applied } }));
    });
    return true;
  });
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
 * state its problems are held in. Nothing for a file no server Zasper knows serves.
 *
 * `linter(null)` is that state, and it is here rather than left to `setDiagnostics` to add for itself: a
 * field appended to a running editor's configuration goes when something reconfigures that editor, and
 * the file editor reconfigures on a settings change — which silently threw every squiggle away. There is
 * no source to run, so the linter never asks anything and never clears what a server published.
 *
 * The gutter the problems are marked in is not here — since story 20 that column also carries the lamp a
 * fix is offered from, so it is one gutter, added by the editor beside these (`lsp/markGutter.ts`).
 */
export function languageServerExtension(root: string, path: string, fileName: string): Extension {
  const language = serverLanguageFor(fileName);
  if (language === null || root === '') {
    return [];
  }
  const connection = connectionFor(language.server, root);
  return [connection.client.plugin(fileUri(root, path), language.languageId), linter(null)];
}

/**
 * Gives a notebook's virtual document to the server for its language, starting it if it is not running.
 * The document is opened in the workspace by the caller, which is what counts it as a reason to keep the
 * server; `detach` stops its diagnostics arriving and takes its problems away.
 */
export function attachNotebook(
  root: string,
  language: ServerLanguage,
  uri: string,
  host: NotebookHost
): { client: LSPClient; workspace: ZasperWorkspace; detach: () => void } {
  const connection = connectionFor(language.server, root);
  notebookHosts.set(uri, host);
  return {
    client: connection.client,
    workspace: connection.client.workspace as ZasperWorkspace,
    detach: () => {
      if (notebookHosts.get(uri) === host) {
        notebookHosts.delete(uri);
        setProblems(connection, host.path, []);
      }
    },
  };
}

/** Whether a server is ready to be asked anything, by its key. */
export function isServerReady(server: string): boolean {
  return connections.get(server)?.status.state === 'ready';
}

/** A file's diagnostics as its server sent them, for a request that has to quote them back. */
export function publishedDiagnostics(path: string): PublishedDiagnostic[] {
  return published.get(path) ?? [];
}

/** A language server ready to be asked about a file, with the root its URIs are under. */
export interface ReadyServer {
  client: LSPClient;
  root: string;
  /** The server key, for a message that has to name it. */
  server: string;
}

/**
 * The server serving a file, if it is ready.
 *
 * Null covers every reason nothing can be asked: the language has no server Zasper knows, the server is
 * still starting, it is not installed, it crashed, or servers are turned off. Every feature built on a
 * request treats that the same way — it does nothing, quietly.
 */
export function readyServerFor(fileName: string): ReadyServer | null {
  const language = serverLanguageFor(fileName);
  if (language === null) {
    return null;
  }
  const connection = connections.get(language.server);
  if (connection === undefined || connection.status.state !== 'ready') {
    return null;
  }
  return { client: connection.client, root: connection.root, server: connection.server };
}

/** Every server that is ready, for a question asked of all of them at once — a symbol by name. */
export function readyServers(): ReadyServer[] {
  return [...connections.values()]
    .filter((connection) => connection.status.state === 'ready')
    .map((connection) => ({
      client: connection.client,
      root: connection.root,
      server: connection.server,
    }));
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
  notebookHosts.clear();
  problems.clear();
  published.clear();
  listeners.clear();
}
