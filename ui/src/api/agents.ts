import { requestEmpty, requestJson } from './client';

/** A coding agent Zasper knows how to start, and whether it is installed here. */
export interface AgentInfo {
  id: string;
  name: string;
  vendor: string;
  installed: boolean;
  /** The command that installs it, and what to do after. */
  install: string;
  then: string;
}

/** A conversation with one agent process, held on the server. */
export interface AgentChat {
  id: string;
  agent: string;
  /** What the agent may do without asking. */
  mode?: AgentMode;
  /** The agent can list its past conversations in the project, and open one again. */
  history?: boolean;
}

/**
 * Something the reader points the agent at with a message: a file, which the agent reads itself, or a
 * cell or an output, sent with its text as the reader sees it.
 */
export interface Mention {
  kind: 'file' | 'cell' | 'output';
  /** Relative to the project. */
  path: string;
  label: string;
  cell_id?: string;
  /** A cell's source or an output's text; the log does not keep it. */
  text?: string;
}

/** A file a turn changed: A added, M modified, D deleted. */
export interface TurnFile {
  path: string;
  status: string;
}

/** One of the agent's past conversations in the project. */
export interface PastChat {
  id: string;
  title?: string;
  /** RFC 3339. */
  updated?: string;
  /** The conversation the chat is in now. */
  current?: boolean;
}

/** ask: everything is asked; edits: file changes are allowed; all: and commands. */
export type AgentMode = 'ask' | 'edits' | 'all';

/** One entry in a chat's log, as the server keeps it. See docs/AGENTS.md. */
export interface ChatEvent {
  seq?: number;
  type:
    | 'user'
    | 'update'
    | 'permission'
    | 'answered'
    | 'turn_end'
    | 'error'
    | 'exited'
    | 'mode'
    | 'terminal'
    | 'changes'
    | 'undone';
  text?: string;
  /** ACP's session/update, as the agent sent it. */
  update?: any;
  permission?: {
    id: string;
    request?: {
      toolCall?: { title?: string; toolCallId?: string };
      options: { optionId: string; name: string; kind: string }[];
    };
    option_id?: string;
    /** Answered by the chat's mode, not the reader. */
    auto?: boolean;
  };
  stop_reason?: string;
  /** On `user`, what the message mentions. */
  mentions?: Mention[];
  /** The files a turn changed, on `changes`; the turn taken back, on `undone`. */
  changes?: { turn: number; files?: TurnFile[] };
  /** What a command the agent runs in Zasper printed since the last, and on the last, how it ended. */
  terminal?: {
    id: string;
    output?: string;
    exited?: boolean;
    exit_code?: number;
    signal?: string;
    /** Not all of it was sent: `output` is the end of it alone. */
    cut?: boolean;
  };
}

export function listAgents(): Promise<AgentInfo[]> {
  return requestJson<AgentInfo[]>('/api/agents');
}

export function listChats(): Promise<AgentChat[]> {
  return requestJson<AgentChat[]>('/api/agents/chats');
}

/** Starts an agent in a chat of its own. The first start of one fetched by npx can take minutes. */
/** Aborting `signal` gives up on the start, and the server stops the agent. */
export function startChat(agent: string, signal?: AbortSignal): Promise<AgentChat> {
  return requestJson<AgentChat>('/api/agents/chats', { method: 'POST', body: { agent }, signal });
}

/** Starts any other agent that speaks ACP, by the command line that runs it. */
export function startCommand(command: string, signal?: AbortSignal): Promise<AgentChat> {
  return requestJson<AgentChat>('/api/agents/chats', { method: 'POST', body: { command }, signal });
}

export function stopChat(id: string): Promise<void> {
  return requestEmpty(`/api/agents/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** A page of the agent's past conversations in the project, newest first, and the cursor of the next. */
export function listPastChats(
  chatId: string,
  cursor = ''
): Promise<{ chats: PastChat[]; next: string }> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return requestJson(`/api/agents/chats/${encodeURIComponent(chatId)}/history${query}`);
}

/** Goes on in a past conversation; the chat's log starts again with the agent's replay of it. */
export function openPastChat(chatId: string, id: string): Promise<void> {
  return requestEmpty(`/api/agents/chats/${encodeURIComponent(chatId)}/load`, {
    method: 'POST',
    body: { id },
  });
}

/**
 * Puts the files a turn changed back as they were before it. Rejects with a 409 whose body lists
 * `changed`, the files changed since, unless `anyway` is set.
 */
export function undoTurn(chatId: string, turn: number, anyway = false): Promise<void> {
  return requestEmpty(`/api/agents/chats/${encodeURIComponent(chatId)}/turns/${turn}/undo`, {
    method: 'POST',
    body: { anyway },
  });
}
