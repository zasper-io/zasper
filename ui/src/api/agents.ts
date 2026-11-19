import { ApiError, requestEmpty, requestJson } from './client';

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
  /** The agent can be signed out from the panel. */
  can_sign_out?: boolean;
  /** The agent takes a message while it works, into the turn it is on, as Antigravity CLI does. */
  steers?: boolean;
  /** The ways the agent offers to be signed in, for one that opens a session without. */
  sign_in_ways?: SignInMethod[];
  /** The way whose key Zasper keeps for the agent, which signing out forgets. */
  kept_key?: string;
}

/**
 * A way the agent offers to be signed in: its own program, run in a terminal with `command` typed in, or
 * one the agent carries out itself when the chat is started with it.
 */
export interface SignInMethod {
  id: string;
  name: string;
  description?: string;
  kind: 'terminal' | 'agent';
  command?: string;
  /** A way the agent carries out with a key from the reader, which Zasper keeps for it. */
  takes_key?: boolean;
}

/** Who the agent says it is signed in as: its own label, such as a plan. */
export interface AgentAccount {
  signed_in: boolean;
  label?: string;
}

export interface SignInRequired {
  methods: SignInMethod[];
  /** Why the agent did not sign itself in, in its words, when it was asked to. */
  refused?: string;
}

/** The ways to sign in, when a start was refused for want of a sign-in; otherwise null. */
export function signInRequiredOf(failure: unknown): SignInRequired | null {
  if (!(failure instanceof ApiError) || failure.status !== 403) {
    return null;
  }
  try {
    const body = JSON.parse(failure.body) as {
      error?: string;
      methods?: SignInMethod[];
      refused?: string;
    };
    return body.error === 'sign_in_required'
      ? { methods: body.methods ?? [], refused: body.refused }
      : null;
  } catch {
    return null;
  }
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
  /** Put back as it was before the turn. */
  undone?: boolean;
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

/** A value one of the agent's settings can take, as ACP's session config options word it. */
export interface AgentSettingValue {
  value: string;
  name: string;
  description?: string | null;
}

/** One of the agent's settings for the session, as ACP's session config options have it. */
export interface AgentSettingOption {
  id: string;
  name: string;
  description?: string | null;
  /** model, thought_level or mode; anything else, or none, is the agent's own. */
  category?: string | null;
  type: 'select' | 'boolean';
  currentValue: string | boolean;
  /** For a select: its values, or groups of them. */
  options?: (AgentSettingValue | { group: string; name: string; options: AgentSettingValue[] })[];
}

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
    | 'settings'
    | 'title'
    | 'sign_in'
    | 'account'
    | 'terminal'
    | 'changes'
    | 'undone'
    | 'question'
    | 'replied'
    | 'subagent';
  text?: string;
  /** ACP's session/update, as the agent sent it. */
  update?: any;
  permission?: {
    id: string;
    request?: {
      /** The call it asks about, as an update to it: its content can carry the change asked for. */
      toolCall?: { title?: string; toolCallId?: string; content?: unknown };
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
  /** On `settings`, the agent's settings, the whole set. */
  settings?: AgentSettingOption[];
  /** On `sign_in`, the ways the agent offers to be signed in again. */
  sign_in?: SignInMethod[];
  /** On `account`, who the agent says it is signed in as. */
  account?: AgentAccount;
  /**
   * On `question`, a form the agent asks the reader to fill in, its fields' JSON Schemas in its order;
   * on `replied`, the reply: accept with what was filled in, decline, or cancel when it was withdrawn.
   */
  question?: {
    id: string;
    tool_call_id?: string;
    message?: string;
    fields?: { name: string; schema: unknown }[];
    required?: string[];
    action?: string;
    content?: Record<string, unknown>;
  };
  /** On `subagent`, a subagent the agent started, as it last reported it. */
  subagent?: {
    id: string;
    /** The session that started it. */
    parent?: string;
    /** Its task, as the call that started it describes it. */
    title?: string;
    depth?: number;
    /** created, running, completed, failed or interrupted. */
    status: string;
    error?: string;
  };
}

export function listAgents(): Promise<AgentInfo[]> {
  return requestJson<AgentInfo[]>('/api/agents');
}

export function listChats(): Promise<AgentChat[]> {
  return requestJson<AgentChat[]>('/api/agents/chats');
}

/**
 * Starts an agent in a chat of its own. The first start of one fetched by npx can take minutes. Aborting
 * `signal` gives up on the start, and the server stops the agent. With `signIn`, the id of a way the
 * agent carries out itself, it signs in first, which can wait on the reader in the browser; `key` is for
 * a way that takes one, and the server keeps it.
 */
export function startChat(
  agent: string,
  signal?: AbortSignal,
  signIn?: string,
  key?: string
): Promise<AgentChat> {
  return requestJson<AgentChat>('/api/agents/chats', {
    method: 'POST',
    body: { agent, sign_in: signIn, key },
    signal,
  });
}

/** Starts any other agent that speaks ACP, by the command line that runs it. */
export function startCommand(
  command: string,
  signal?: AbortSignal,
  signIn?: string,
  key?: string
): Promise<AgentChat> {
  return requestJson<AgentChat>('/api/agents/chats', {
    method: 'POST',
    body: { command, sign_in: signIn, key },
    signal,
  });
}

export function stopChat(id: string): Promise<void> {
  return requestEmpty(`/api/agents/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Signs the agent out, everywhere it is used on this computer, and answers the ways it offers to be
 * signed in again. The chat is the caller's to end.
 */
export async function signOutChat(id: string): Promise<SignInMethod[]> {
  const answer = await requestJson<{ methods?: SignInMethod[] }>(
    `/api/agents/chats/${encodeURIComponent(id)}/sign-out`,
    { method: 'POST' }
  );
  return answer.methods ?? [];
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
/** Goes on in a past conversation, headed by `title`, as the list gave it, until the agent sends its own. */
export function openPastChat(chatId: string, id: string, title?: string): Promise<void> {
  return requestEmpty(`/api/agents/chats/${encodeURIComponent(chatId)}/load`, {
    method: 'POST',
    body: { id, title: title ?? '' },
  });
}

/**
 * Puts the files a turn changed back as they were before it: those at `paths`, or every one not put back
 * yet. Rejects with a 409 whose body lists `changed`, the files changed since, unless `anyway` is set.
 */
export function undoTurn(
  chatId: string,
  turn: number,
  anyway = false,
  paths?: string[]
): Promise<void> {
  return requestEmpty(`/api/agents/chats/${encodeURIComponent(chatId)}/turns/${turn}/undo`, {
    method: 'POST',
    body: { anyway, paths },
  });
}
