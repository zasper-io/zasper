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
  /** What it printed or answered, as text. */
  output: string;
  /** The changes it made to files. */
  diffs: ToolDiff[];
  /** The terminal its command ran in, when the agent showed one. */
  terminalId?: string;
  terminal?: Terminal;
  /** How long it has been running, as the agent last said. */
  elapsedSeconds?: number;
}

export interface Terminal {
  output: string;
  /** The start of the output was not sent. */
  cut: boolean;
  /** Set once the command has ended. */
  exit?: { code: number | null; signal: string | null };
}

export interface ToolDiff {
  path: string;
  /** Null for a file it created. */
  oldText: string | null;
  newText: string;
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

/** A tool call's content, which an update replaces whole: its text, and its diffs. */
function contentOf(
  content: unknown
): { output: string; diffs: ToolDiff[]; terminalId?: string } | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const output: string[] = [];
  const diffs: ToolDiff[] = [];
  let terminalId: string | undefined;
  for (const entry of content) {
    if (entry?.type === 'terminal' && typeof entry.terminalId === 'string') {
      terminalId = entry.terminalId;
    }
    if (entry?.type === 'content') {
      const text = unfenced(textOf(entry.content));
      if (text !== '') output.push(text);
    } else if (entry?.type === 'diff' && typeof entry.path === 'string') {
      diffs.push({
        path: entry.path,
        oldText: entry.oldText ?? null,
        newText: entry.newText ?? '',
      });
    }
  }
  return { output: output.join('\n'), diffs, ...(terminalId ? { terminalId } : {}) };
}

/**
 * A command's output as text to read: colours and cursor moves taken out, and a line the command drew
 * over with a carriage return, such as a progress bar, as it was left.
 */
export function terminalText(output: string): string {
  return output
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.slice(line.lastIndexOf('\r') + 1))
    .join('\n');
}

/** Text an agent wrapped in a markdown code fence, without it: the panel already shows it as code. */
function unfenced(text: string): string {
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(text.trim());
  return fenced ? fenced[1] : text;
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
  const terminals = new Map<string, Terminal>();
  /** The calls a question is open on, by the question's id. */
  const asking = new Map<string, string>();
  const terminal = (id: string) => {
    let found = terminals.get(id);
    if (found === undefined) {
      found = { output: '', cut: false };
      terminals.set(id, found);
    }
    return found;
  };
  /*
   * Claude Code runs its commands itself, and sends what one printed and how it ended beside the call,
   * under the call's own id.
   */
  const fromMeta = (call: ToolCall | undefined, meta: any) => {
    if (call === undefined || meta === undefined) return;
    const info = meta.terminal_info?.terminal_id;
    if (typeof info === 'string') {
      call.terminalId = info;
      terminal(info);
    }
    for (const printed of [meta.terminal_output, meta.terminal_output_delta]) {
      if (typeof printed?.terminal_id === 'string') {
        terminal(printed.terminal_id).output += printed.data ?? '';
      }
    }
    const exit = meta.terminal_exit;
    if (typeof exit?.terminal_id === 'string') {
      terminal(exit.terminal_id).exit = {
        code: exit.exit_code ?? null,
        signal: exit.signal ?? null,
      };
    }
    const elapsed = meta.claudeCode?.toolResponse?.elapsedTimeSeconds;
    if (typeof elapsed === 'number') {
      call.elapsedSeconds = elapsed;
    }
  };

  for (const event of events) {
    switch (event.type) {
      case 'user':
        items.push({ kind: 'user', text: event.text ?? '' });
        answering = true;
        break;
      case 'update': {
        const update = event.update ?? {};
        switch (update.sessionUpdate) {
          // A past conversation the agent replays has the reader's messages in it.
          case 'user_message_chunk': {
            const text = textOf(update.content);
            const previous = last();
            if (previous?.kind === 'user') {
              previous.text += text;
            } else if (text !== '') {
              items.push({ kind: 'user', text });
            }
            break;
          }
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
              ...(contentOf(update.content) ?? { output: '', diffs: [] }),
            };
            fromMeta(call, update._meta);
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
              const content = contentOf(update.content);
              if (content) {
                call.output = content.output;
                call.diffs = content.diffs;
                call.terminalId = content.terminalId ?? call.terminalId;
              }
            }
            fromMeta(call, update._meta);
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
        if (request?.toolCall?.toolCallId) {
          asking.set(event.permission?.id ?? '', request.toolCall.toolCallId);
        }
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
        asking.delete(event.permission?.id ?? '');
        if (question?.kind === 'permission') {
          question.answer = event.permission?.option_id || null;
          question.auto = event.permission?.auto;
        }
        break;
      }
      case 'mode':
        mode = (event.text as AgentMode) ?? 'ask';
        break;
      case 'terminal': {
        const printed = event.terminal;
        if (printed === undefined) break;
        const shown = terminal(printed.id);
        if (printed.cut) {
          shown.output = printed.output ?? '';
          shown.cut = true;
        } else {
          shown.output += printed.output ?? '';
        }
        if (printed.exited) {
          shown.exit = { code: printed.exit_code ?? null, signal: printed.signal ?? null };
        }
        break;
      }
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
  for (const item of items) {
    if (item.kind === 'tools') {
      for (const call of item.calls) {
        if (call.terminalId !== undefined) {
          call.terminal = terminals.get(call.terminalId);
        }
        // Claude Code leaves a command pending until it has finished. Once nothing is asked of it, it
        // is running.
        const asked = [...asking.values()].includes(call.id);
        if (
          call.terminal &&
          !call.terminal.exit &&
          call.status === 'pending' &&
          answering &&
          !asked
        ) {
          call.status = 'in_progress';
        }
      }
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
