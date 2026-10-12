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
}

/** One entry in a chat's log, as the server keeps it. See docs/AGENTS.md. */
export interface ChatEvent {
  seq?: number;
  type: 'user' | 'update' | 'permission' | 'answered' | 'turn_end' | 'error' | 'exited';
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
  };
  stop_reason?: string;
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
