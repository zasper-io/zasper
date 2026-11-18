import {
  AgentMode,
  AgentSettingOption,
  AgentSettingValue,
  AgentAccount,
  ChatEvent,
  SignInMethod,
  Mention,
  TurnFile,
} from '@/api';
import { NEARLY_FULL } from '@/ide/resources/memory';

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
  /** What a subagent this call started did, its own calls in order. */
  calls: ToolCall[];
  /** A command the agent left running while it went on. */
  background?: boolean;
  /** A document it wrote for the reader, such as a plan, to open in a tab of its own. */
  doc?: AgentDoc;
}

/** A document an agent wrote for the reader: its file, and its text as written. */
export interface AgentDoc {
  /** Absolute: the agent keeps it where it likes, outside the project as often as not. */
  path: string;
  name: string;
  text: string;
}

const baseName = (path: string) => path.split('/').pop() ?? path;

/**
 * The document a call wrote for the reader, if it did. Antigravity marks such a write's input with
 * `ArtifactMetadata.UserFacing`, a plan in Plan mode among them; its text is the write's diff, or the
 * input's `Content` before the diff has come.
 */
function docOf(update: { rawInput?: any }, call: ToolCall): AgentDoc | undefined {
  const input = update.rawInput;
  if (input?.ArtifactMetadata?.UserFacing !== true) {
    return call.doc;
  }
  const path = typeof input.Path === 'string' ? input.Path : call.locations[0];
  if (!path) {
    return call.doc;
  }
  const written = call.diffs.find((diff) => diff.path === path)?.newText;
  const text = written ?? (typeof input.Content === 'string' ? input.Content : undefined);
  return text === undefined ? call.doc : { path, name: baseName(path), text };
}

/**
 * A call's title as the reader reads it. An agent that names a file outside the project by its path
 * from the project gets `File ../../../../Users/…/plan.md`; the file's own name says as much.
 */
function titleOf(title: string, locations: string[]): string {
  const outside = /(?:\.\.\/)+\S+/;
  return locations.length > 0 && outside.test(title)
    ? title.replace(outside, baseName(locations[0]))
    : title;
}

/** Every call, those a subagent made under the call that started it included. */
function allCalls(calls: ToolCall[]): ToolCall[] {
  return calls.flatMap((call) => [call, ...allCalls(call.calls)]);
}

/**
 * The call a subagent's update belongs under. Claude Code tags all a subagent does, calls and words
 * alike, with the call that started it.
 */
function parentOf(update: { _meta?: any }): string | undefined {
  const parent = update._meta?.claudeCode?.parentToolUseId;
  return typeof parent === 'string' ? parent : undefined;
}

// A command the agent started and went on without, as Claude Code's Bash has it.
function inBackground(update: { rawInput?: any }): boolean {
  return update.rawInput?.run_in_background === true;
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
  | { kind: 'user'; text: string; mentions: Mention[] }
  | { kind: 'agent'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tools'; calls: ToolCall[] }
  | {
      kind: 'permission';
      id: string;
      title: string;
      options: PermissionOption[];
      /** The change it asks to make, when the agent says. */
      diffs: ToolDiff[];
      /** The option chosen; null once withdrawn; undefined while it waits. */
      answer?: string | null;
      /** The chat's mode answered it. */
      auto?: boolean;
    }
  | { kind: 'note'; text: string; failed: boolean }
  /** Something the agent, or the panel, says about the session rather than in the conversation. */
  | { kind: 'notice'; severity: 'info' | 'warning' | 'error'; title: string; description?: string }
  /** The conversation summarised to free the context: tokens before and after, when the agent said. */
  | {
      kind: 'compaction';
      id: string;
      /** in_progress, completed, failed or cancelled. */
      status: string;
      summary: string;
      before?: number;
      after?: number;
    }
  /** The files a turn changed, once it has ended; `undone` once they were put back. */
  | { kind: 'changes'; turn: number; files: TurnFile[]; undone: boolean };

export interface PlanEntry {
  content: string;
  /** pending, in_progress or completed. */
  status: string;
}

/** One of the agent's settings: a choice of values, or a switch. */
export type AgentSetting =
  | {
      kind: 'choice';
      id: string;
      name: string;
      description?: string;
      category: string;
      value: string;
      values: AgentSettingValue[];
    }
  | {
      kind: 'switch';
      id: string;
      name: string;
      description?: string;
      category: string;
      value: boolean;
    };

export interface ChatView {
  items: ChatItem[];
  plan: PlanEntry[];
  /** The agent is on a turn: the composer's button is Stop. */
  answering: boolean;
  /** The agent's process has ended, and nothing more can be sent. */
  exited: boolean;
  mode: AgentMode;
  /** The agent's own settings, as it last sent them. */
  settings: AgentSetting[];
  /** The chat's title, once the agent has named it. */
  title?: string;
  /** How full the context window is, once the agent has said. */
  usage?: ContextUsage;
  /** The commands the agent takes at the start of a message, as it last listed them. */
  commands: AgentCommand[];
  /** Who the agent last said it is signed in as. */
  account?: AgentAccount;
  /** The agent will not go on until someone signs in: the ways it offers. */
  signIn?: SignInMethod[];
  /** The documents the agent wrote for the reader, each as last written. */
  docs: AgentDoc[];
}

export interface AgentCommand {
  /** Without its slash. */
  name: string;
  description: string;
  /** What to type after it, when it takes something. */
  hint?: string;
}

export interface ContextUsage {
  /** Tokens in the context window. */
  used: number;
  size: number;
  /** What the session has cost so far, by the agent's own count. */
  cost?: { amount: number; currency: string };
}

function settingOf(option: AgentSettingOption): AgentSetting | undefined {
  const common = {
    id: option.id,
    name: option.name,
    category: option.category ?? '',
    ...(option.description ? { description: option.description } : {}),
  };
  if (option.type === 'boolean' && typeof option.currentValue === 'boolean') {
    return { kind: 'switch', ...common, value: option.currentValue };
  }
  if (typeof option.currentValue !== 'string') {
    return undefined;
  }
  const values = (option.options ?? []).flatMap((entry) =>
    'group' in entry ? entry.options : [entry]
  );
  return { kind: 'choice', ...common, value: option.currentValue, values };
}

function textOf(content: unknown): string {
  const block = content as { type?: string; text?: string } | undefined;
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
}

function findCall(items: ChatItem[], id: string): ToolCall | undefined {
  for (const item of items) {
    if (item.kind === 'tools') {
      const call = allCalls(item.calls).find((each) => each.id === id);
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
  let settings: AgentSetting[] = [];
  let title: string | undefined;
  // A reopened conversation's title as the agent listed it, until the agent sends one of its own.
  let listedTitle: string | undefined;
  let usage: ContextUsage | undefined;
  let commands: AgentCommand[] = [];
  let account: AgentAccount | undefined;
  let signIn: SignInMethod[] | undefined;
  // By path, so a document written again is the one document at its latest.
  const docs = new Map<string, AgentDoc>();
  const noteDoc = (doc: AgentDoc | undefined) => {
    if (doc) {
      docs.set(doc.path, doc);
    }
  };
  // Whether the context was at least nearly full when last heard of, so the warning is said once a crossing.
  let nearlyFull = false;
  const compaction = (id: unknown) =>
    items.find(
      (item): item is ChatItem & { kind: 'compaction' } =>
        item.kind === 'compaction' && item.id === id
    );
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
        items.push({ kind: 'user', text: event.text ?? '', mentions: event.mentions ?? [] });
        answering = true;
        break;
      case 'update': {
        const update = event.update ?? {};
        switch (update.sessionUpdate) {
          // A past conversation the agent replays has the reader's messages in it.
          case 'user_message_chunk': {
            const text = textOf(update.content);
            const link = update.content?.type === 'resource_link' ? update.content : undefined;
            const mentions: Mention[] = link
              ? [{ kind: 'file', path: link.name, label: link.name.split('/').pop() ?? link.name }]
              : [];
            const previous = last();
            if (previous?.kind === 'user') {
              previous.text += text;
              previous.mentions.push(...mentions);
            } else if (text !== '' || mentions.length > 0) {
              items.push({ kind: 'user', text, mentions });
            }
            break;
          }
          case 'agent_message_chunk':
          case 'agent_thought_chunk': {
            // A subagent's words are its own: what it hands back is its call's output.
            if (parentOf(update) && findCall(items, parentOf(update)!)) {
              break;
            }
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
              title: titleOf(update.title ?? 'Tool', locationsOf(update) ?? []),
              kind: update.kind ?? 'other',
              status: update.status ?? 'pending',
              locations: locationsOf(update) ?? [],
              ...(contentOf(update.content) ?? { output: '', diffs: [] }),
              calls: [],
              ...(inBackground(update) ? { background: true } : {}),
            };
            call.doc = docOf(update, call);
            noteDoc(call.doc);
            fromMeta(call, update._meta);
            const parent = parentOf(update) && findCall(items, parentOf(update)!);
            const previous = last();
            if (parent) {
              parent.calls.push(call);
            } else if (previous?.kind === 'tools') {
              previous.calls.push(call);
            } else {
              items.push({ kind: 'tools', calls: [call] });
            }
            break;
          }
          case 'tool_call_update': {
            const call = findCall(items, update.toolCallId);
            if (call) {
              call.locations = locationsOf(update) ?? call.locations;
              call.title = update.title ? titleOf(update.title, call.locations) : call.title;
              call.kind = update.kind ?? call.kind;
              call.status = update.status ?? call.status;
              call.background = call.background || inBackground(update) || undefined;
              const content = contentOf(update.content);
              if (content) {
                call.output = content.output;
                call.diffs = content.diffs;
                call.terminalId = content.terminalId ?? call.terminalId;
              }
              call.doc = docOf(update, call);
              noteDoc(call.doc);
            }
            fromMeta(call, update._meta);
            break;
          }
          // Left out, the title stands; null takes it away.
          case 'session_info_update':
            if ('title' in update) {
              title = update.title || undefined;
            }
            break;
          case 'available_commands_update':
            commands = (update.availableCommands ?? [])
              .filter((command: { name?: unknown }) => typeof command?.name === 'string')
              .map(
                (command: { name: string; description?: string; input?: { hint?: string } }) => ({
                  name: command.name.replace(/^\//, ''),
                  description: command.description ?? '',
                  ...(command.input?.hint ? { hint: command.input.hint } : {}),
                })
              );
            break;
          case 'notice':
            if (typeof update.title === 'string') {
              items.push({
                kind: 'notice',
                severity: ['info', 'warning', 'error'].includes(update.severity)
                  ? update.severity
                  : 'info',
                title: update.title,
                ...(typeof update.description === 'string'
                  ? { description: update.description }
                  : {}),
              });
            }
            break;
          case 'compaction_update': {
            const found = compaction(update.compactionId);
            const summary = Array.isArray(update.summary)
              ? update.summary.map(textOf).join('')
              : undefined;
            if (found) {
              found.status = update.status ?? found.status;
              found.summary = summary ?? found.summary;
            } else {
              items.push({
                kind: 'compaction',
                id: update.compactionId,
                status: update.status ?? 'in_progress',
                summary: summary ?? '',
                ...(usage ? { before: usage.used } : {}),
              });
            }
            break;
          }
          case 'compaction_summary_chunk': {
            const found = compaction(update.compactionId);
            if (found) found.summary += textOf(update.content);
            break;
          }
          case 'usage_update':
            if (typeof update.used === 'number' && typeof update.size === 'number') {
              usage = {
                used: update.used,
                size: update.size,
                ...(typeof update.cost?.amount === 'number'
                  ? {
                      cost: { amount: update.cost.amount, currency: update.cost.currency ?? 'USD' },
                    }
                  : {}),
              };
              for (const item of items) {
                if (
                  item.kind === 'compaction' &&
                  item.status === 'completed' &&
                  item.after === undefined
                ) {
                  item.after = update.used;
                }
              }
              const full = update.size > 0 && update.used / update.size >= NEARLY_FULL;
              if (full && !nearlyFull) {
                const percent = Math.round((update.used / update.size) * 100);
                items.push({
                  kind: 'notice',
                  severity: 'warning',
                  title: `The context is ${percent}% full.`,
                  ...(commands.some((command) => command.name === 'compact')
                    ? { description: '/compact summarises the conversation so far.' }
                    : {}),
                });
              }
              nearlyFull = full;
            }
            break;
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
        const asked = request?.toolCall;
        const content = contentOf(asked?.content);
        const call = asked?.toolCallId ? findCall(items, asked.toolCallId) : undefined;
        if (asked?.toolCallId) {
          asking.set(event.permission?.id ?? '', asked.toolCallId);
        }
        // The request's tool call updates the call it asks about, as ACP has it. Antigravity sends an
        // edit's diff only here, so without this the change is never seen.
        if (call) {
          call.title = asked?.title ? titleOf(asked.title, call.locations) : call.title;
          if (content?.diffs.length) {
            call.diffs = content.diffs;
          }
          if (content?.output) {
            call.output = content.output;
          }
        }
        items.push({
          kind: 'permission',
          id: event.permission?.id ?? '',
          title: asked?.title ?? call?.title ?? 'The agent asks to go on',
          options: request?.options ?? [],
          diffs: content?.diffs ?? [],
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
      case 'account':
        account = event.account;
        break;
      case 'sign_in':
        answering = false;
        signIn = event.sign_in ?? [];
        break;
      case 'title':
        listedTitle = event.text || undefined;
        break;
      case 'mode':
        mode = (event.text as AgentMode) ?? 'ask';
        break;
      case 'settings':
        settings = (event.settings ?? [])
          .map(settingOf)
          .filter((setting): setting is AgentSetting => setting !== undefined);
        break;
      case 'changes':
        if (event.changes) {
          items.push({
            kind: 'changes',
            turn: event.changes.turn,
            files: (event.changes.files ?? []).map((file) => ({ ...file, undone: false })),
            undone: false,
          });
        }
        break;
      // The files put back, or, in a log from before files could be put back one by one, all of them.
      case 'undone': {
        const named = event.changes?.files?.map((file) => file.path);
        for (const item of items) {
          if (item.kind === 'changes' && item.turn === event.changes?.turn) {
            for (const file of item.files) {
              file.undone = file.undone || named === undefined || named.includes(file.path);
            }
            item.undone = item.files.every((file) => file.undone);
          }
        }
        break;
      }
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
        } else if (last()?.kind === 'user') {
          // Nothing came back: Antigravity answers `/compact` with only the turn's end. Said, so the
          // reader is not left watching their own message.
          items.push({ kind: 'note', text: 'Done, with no reply.', failed: false });
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
      for (const call of allCalls(item.calls)) {
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
  return {
    items,
    plan,
    answering,
    exited,
    mode,
    settings,
    title: title ?? listedTitle,
    usage,
    commands,
    account,
    signIn,
    docs: [...docs.values()],
  };
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
