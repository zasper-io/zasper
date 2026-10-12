import { AgentMode, ChatEvent } from '@/api';

/** A tool the agent called, as its calls and their updates have it so far. */
export interface ToolCall {
  id: string;
  title: string;
  /** ACP's kind: read, edit, delete, move, search, execute, think, fetch, other. */
  kind: string;
  /** pending, in_progress, completed or failed. */
  status: string;
  /** The files it touched, absolute. */
  locations: string[];
}

export interface PermissionOption {
  optionId: string;
  name: string;
  /** allow_once, allow_always, reject_once or reject_always. */
  kind: string;
}

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tools'; calls: ToolCall[] }
  | {
      kind: 'permission';
      id: string;
      title: string;
      options: PermissionOption[];
      /** The option chosen; null once withdrawn; undefined while it waits. */
      answer?: string | null;
      /** The chat's mode answered it. */
      auto?: boolean;
    }
  | { kind: 'note'; text: string; failed: boolean };

export interface PlanEntry {
  content: string;
  /** pending, in_progress or completed. */
  status: string;
}

export interface ChatView {
  items: ChatItem[];
  plan: PlanEntry[];
  /** The agent is on a turn: the composer's button is Stop. */
  answering: boolean;
  /** The agent's process has ended, and nothing more can be sent. */
  exited: boolean;
  mode: AgentMode;
}

function textOf(content: unknown): string {
  const block = content as { type?: string; text?: string } | undefined;
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
}

function findCall(items: ChatItem[], id: string): ToolCall | undefined {
  for (const item of items) {
    if (item.kind === 'tools') {
      const call = item.calls.find((each) => each.id === id);
      if (call) return call;
    }
  }
  return undefined;
}

function locationsOf(update: { locations?: { path?: string }[] }): string[] | undefined {
  return update.locations
    ?.map((location) => location.path)
    .filter((path): path is string => typeof path === 'string');
}

/**
 * What a chat's log adds up to, for the panel to draw: the agent's streamed chunks joined into messages,
 * each tool call one row that its updates change, the latest plan, and the questions with their answers.
 */
export function foldChat(events: ChatEvent[]): ChatView {
  const items: ChatItem[] = [];
  let plan: PlanEntry[] = [];
  let answering = false;
  let exited = false;
  let mode: AgentMode = 'ask';
  const last = () => items[items.length - 1];

  for (const event of events) {
    switch (event.type) {
      case 'user':
        items.push({ kind: 'user', text: event.text ?? '' });
        answering = true;
        break;
      case 'update': {
        const update = event.update ?? {};
        switch (update.sessionUpdate) {
          case 'agent_message_chunk':
          case 'agent_thought_chunk': {
            const kind = update.sessionUpdate === 'agent_message_chunk' ? 'agent' : 'thought';
            const text = textOf(update.content);
            const previous = last();
            if (previous?.kind === kind) {
              previous.text += text;
            } else if (text !== '') {
              items.push({ kind, text });
            }
            break;
          }
          case 'tool_call': {
            const call: ToolCall = {
              id: update.toolCallId,
              title: update.title ?? 'Tool',
              kind: update.kind ?? 'other',
              status: update.status ?? 'pending',
              locations: locationsOf(update) ?? [],
            };
            const previous = last();
            if (previous?.kind === 'tools') {
              previous.calls.push(call);
            } else {
              items.push({ kind: 'tools', calls: [call] });
            }
            break;
          }
          case 'tool_call_update': {
            const call = findCall(items, update.toolCallId);
            if (call) {
              call.title = update.title ?? call.title;
              call.kind = update.kind ?? call.kind;
              call.status = update.status ?? call.status;
              call.locations = locationsOf(update) ?? call.locations;
            }
            break;
          }
          case 'plan':
            plan = (update.entries ?? []).map((entry: PlanEntry) => ({
              content: entry.content,
              status: entry.status,
            }));
            break;
        }
        break;
      }
      case 'permission': {
        const request = event.permission?.request;
        items.push({
          kind: 'permission',
          id: event.permission?.id ?? '',
          title: request?.toolCall?.title ?? 'The agent asks to go on',
          options: request?.options ?? [],
        });
        break;
      }
      case 'answered': {
        const question = items.find(
          (item) => item.kind === 'permission' && item.id === event.permission?.id
        );
        if (question?.kind === 'permission') {
          question.answer = event.permission?.option_id || null;
          question.auto = event.permission?.auto;
        }
        break;
      }
      case 'mode':
        mode = (event.text as AgentMode) ?? 'ask';
        break;
      case 'turn_end':
        answering = false;
        if (event.stop_reason && event.stop_reason !== 'end_turn') {
          items.push({ kind: 'note', text: stopNote(event.stop_reason), failed: false });
        }
        break;
      case 'error':
        answering = false;
        items.push({ kind: 'note', text: event.text ?? 'Something went wrong.', failed: true });
        break;
      case 'exited':
        answering = false;
        exited = true;
        items.push({ kind: 'note', text: event.text ?? 'The agent stopped.', failed: true });
        break;
    }
  }
  return { items, plan, answering, exited, mode };
}

function stopNote(reason: string): string {
  switch (reason) {
    case 'cancelled':
      return 'Stopped.';
    case 'max_tokens':
    case 'max_turn_requests':
      return 'The agent stopped at its limit for one turn.';
    case 'refusal':
      return 'The agent declined.';
    default:
      return `The agent stopped (${reason}).`;
  }
}
