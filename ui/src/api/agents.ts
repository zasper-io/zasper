import { requestEmpty, requestJson } from './client';

/** A coding agent Zasper knows how to start, and whether it is installed here. */
export interface AgentInfo {
  id: string;
  name: string;
  installed: boolean;
  /** What to do when it is not installed. */
  hint: string;
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
    | 'terminal';
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
export function startChat(agent: string): Promise<AgentChat> {
  return requestJson<AgentChat>('/api/agents/chats', { method: 'POST', body: { agent } });
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
