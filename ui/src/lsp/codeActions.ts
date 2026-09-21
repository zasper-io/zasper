import { LSPPlugin } from '@codemirror/lsp-client';
import { EditorView } from '@codemirror/view';

import { publishedDiagnostics, readyServerFor } from './servers';
import { ProtocolRange } from './workspaceEdits';
import { applyWorkspaceEdit, EditOutcome, ProtocolWorkspaceEdit } from './workspaceEdits';

/** A fix or a refactor as the server offers it, with enough of its own answer kept to carry it out. */
export interface CodeAction {
  title: string;
  /** `quickfix`, `refactor.extract`, `source.organizeImports` — the protocol's dotted kinds. */
  kind?: string;
  /** The server marked this the one to offer first. */
  preferred: boolean;
  raw: ServerAction;
}

interface ServerAction {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  edit?: ProtocolWorkspaceEdit;
  command?: string | { command: string; arguments?: unknown[]; title?: string };
  data?: unknown;
  /** A plain `Command` answer rather than a `CodeAction`, which older servers still send. */
  arguments?: unknown[];
}

/** The range a code action is asked about: the selection, or the line the cursor is on. */
function askedRange(view: EditorView, plugin: LSPPlugin): ProtocolRange {
  const selection = view.state.selection.main;
  return {
    start: plugin.toPosition(selection.from),
    end: plugin.toPosition(selection.to),
  };
}

/**
 * The fixes and refactors a server offers where the cursor is.
 *
 * The server is given back its own diagnostics for the range: some fixes exist only as the answer to a
 * particular diagnostic, and a server handed an empty list would not offer them.
 */
export async function codeActionsAt(
  path: string,
  fileName: string,
  view: EditorView
): Promise<CodeAction[]> {
  const ready = readyServerFor(fileName);
  const plugin = LSPPlugin.get(view);
  if (
    ready === null ||
    plugin === null ||
    ready.client.serverCapabilities?.codeActionProvider == null
  ) {
    return [];
  }
  const range = askedRange(view, plugin);
  const lines = { from: range.start.line, to: range.end.line };
  const diagnostics = publishedDiagnostics(path).filter(
    (item) => item.range.end.line >= lines.from && item.range.start.line <= lines.to
  );
  ready.client.sync();
  const answer = await ready.client.request<unknown, ServerAction[] | null>(
    'textDocument/codeAction',
    {
      textDocument: { uri: plugin.uri },
      range,
      context: { diagnostics },
    }
  );
  return (answer ?? []).map((action) => ({
    title: typeof action.title === 'string' ? action.title : 'Fix',
    kind: action.kind,
    preferred: action.isPreferred === true,
    raw: action,
  }));
}

/**
 * Carries out an action.
 *
 * Three shapes have to be handled. An action with an edit is applied here. An action with neither, but
 * with `data`, is resolved first — servers send the title cheaply and compute the edit only when it is
 * chosen. An action that is a command is executed on the server, which then asks the editor to make the
 * edit; that request is answered in `servers.ts`.
 */
export async function runCodeAction(
  fileName: string,
  action: CodeAction
): Promise<EditOutcome | null> {
  const ready = readyServerFor(fileName);
  if (ready === null) {
    throw new Error('No language server is running for this file.');
  }
  let chosen = action.raw;
  if (chosen.edit === undefined && chosen.data !== undefined) {
    chosen = await ready.client.request<ServerAction, ServerAction>('codeAction/resolve', chosen);
  }
  if (chosen.edit !== undefined) {
    return applyWorkspaceEdit(ready.root, chosen.edit);
  }
  const command = chosen.command;
  if (command === undefined) {
    // A `Command` answer: the action itself is the command, and its title is what was shown.
    return runCommand(fileName, chosen as unknown as { command?: string; arguments?: unknown[] });
  }
  return runCommand(
    fileName,
    typeof command === 'string' ? { command, arguments: chosen.arguments } : command
  );
}

async function runCommand(
  fileName: string,
  command: { command?: string; arguments?: unknown[] }
): Promise<null> {
  const ready = readyServerFor(fileName);
  if (ready === null || command.command === undefined) {
    return null;
  }
  await ready.client.request<unknown, unknown>('workspace/executeCommand', {
    command: command.command,
    arguments: command.arguments ?? [],
  });
  return null;
}
