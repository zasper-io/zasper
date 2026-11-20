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
import { QuestionField, QuestionInput, questionInputs } from './questions';

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
  /** The subagent it sent off to work in the background, as OpenCode does. */
  subagent?: Subagent;
}

/** A subagent working in a session of its own, which goes on after the call that started it. */
export interface Subagent {
  /** Its session, once the agent has said. */
  session?: string;
  /** Its kind, as the agent names it: explore. */
  agent: string;
  task: string;
  /** created, running, completed, failed or interrupted, once it has reported. */
  status?: string;
  error?: string;
  /** What it said after its last call, which is what it hands back. */
  report: string;
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
 * from the project gets `File ../../../../Users/…/plan.md`; the file's own name says as much. OpenCode
 * names a call by its tool alone, `read`, the file in its locations: the two together say what it did.
 */
function titleOf(title: string, locations: string[], input?: any): string {
  const outside = /(?:\.\.\/)+\S+/;
  if (locations.length > 0 && outside.test(title)) {
    return title.replace(outside, baseName(locations[0]));
  }
  // A search OpenCode names by its tool alone, its place the folder searched: what it looked for says more.
  if (/^\S+$/.test(title) && typeof input?.pattern === 'string') {
    return `${title} ${input.pattern}`;
  }
  const file = locations.length === 1 ? baseName(locations[0]) : '';
  if (file && /^\S+$/.test(title) && !title.includes(file)) {
    return `${title} ${file}`;
  }
  return title;
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

/** A subagent's kind as a name: explore is Explore. */
export function subagentName(subagent: Subagent): string {
  return subagent.agent.charAt(0).toUpperCase() + subagent.agent.slice(1);
}

/**
 * The subagent an OpenCode `subagent` call sends off: its input names it and its task, and once the call
 * has answered, its output names its session.
 */
function subagentOf(
  update: { rawInput?: any; rawOutput?: any },
  call: ToolCall
): Subagent | undefined {
  const input = update.rawInput;
  let found = call.subagent;
  if (
    found === undefined &&
    typeof input?.agent === 'string' &&
    typeof input?.description === 'string'
  ) {
    found = { agent: input.agent, task: input.description, report: '' };
  }
  const session = update.rawOutput?.metadata?.sessionID;
  if (found !== undefined && typeof session === 'string') {
    found.session = session;
  }
  return found;
}

/**
 * Names a call that sends a subagent off by the subagent and its task, and shows what it hands back, not
 * the agent's note to itself that it is working.
 */
function nameSubagent(call: ToolCall, update: { rawInput?: any; rawOutput?: any }) {
  const subagent = subagentOf(update, call);
  if (subagent === undefined) {
    return;
  }
  call.subagent = subagent;
  call.title = `${subagentName(subagent)} · ${subagent.task}`;
  call.output = subagent.report;
}

/** The subagent session an update is from, as OpenCode marks one, with the task it was given. */
function childOf(update: { _meta?: any }): { id: string; title?: string } | undefined {
  const child = update._meta?.['opencode/child-session'];
  if (typeof child?.id !== 'string') {
    return undefined;
  }
  return { id: child.id, ...(typeof child.title === 'string' ? { title: child.title } : {}) };
}

/**
 * The call that sent the subagent off: by its session, or before the call has said it, by its task.
 */
function subagentCall(items: ChatItem[], session: string, task?: string): ToolCall | undefined {
  const calls = items.flatMap((item) => (item.kind === 'tools' ? allCalls(item.calls) : []));
  const found =
    calls.find((call) => call.subagent?.session === session) ??
    calls.find(
      (call) => call.subagent && call.subagent.session === undefined && call.subagent.task === task
    );
  if (found?.subagent) {
    found.subagent.session = session;
  }
  return found;
}

/** A subagent's call as named without the task OpenCode puts before it: `grep`, not `Find calls: grep`. */
function ownTitle(update: { title?: string; _meta?: any }): string | undefined {
  const task = childOf(update)?.title;
  return task && update.title?.startsWith(`${task}: `)
    ? update.title.slice(task.length + 2)
    : update.title;
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
  | { kind: 'changes'; turn: number; files: TurnFile[]; undone: boolean }
  /** A form the agent asks the reader to fill in. */
  | {
      kind: 'question';
      id: string;
      message?: string;
      inputs: QuestionInput[];
      /** accept with what was filled in, decline, or cancel once withdrawn; undefined while it waits. */
      reply?: { action: string; content?: Record<string, unknown> };
    };

export interface PlanEntry {
  content: string;
  /** pending, in_progress or completed. */
  status: string;
}

/** One value of a choice, with the group it is listed under, when it has one. */
export type AgentChoiceValue = AgentSettingValue & { group?: string };

/** One of the agent's settings: a choice of values, or a switch. */
export type AgentSetting =
  | {
      kind: 'choice';
      id: string;
      name: string;
      description?: string;
      category: string;
      value: string;
      values: AgentChoiceValue[];
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
  /** With `signIn`, the message the agent would not take for want of it. */
  refused?: string;
  /** The agent has said it is signed in, so a sign-in it asks for is a second one. */
  wasSignedIn: boolean;
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
  const values = (option.options ?? []).flatMap((entry): AgentChoiceValue[] =>
    'group' in entry
      ? entry.options.map((value) => ({ ...value, group: entry.name }))
      : [providerOf(entry, option.category)]
  );
  return { kind: 'choice', ...common, value: option.currentValue, values };
}

/**
 * A model OpenCode names with its provider first, `opencode/Big Pickle`, by its own name under its
 * provider. zasper-prototype's story-agent-opencode.html draws it.
 */
function providerOf(value: AgentSettingValue, category?: string | null): AgentChoiceValue {
  const named = category === 'model' ? /^([^/\s]+)\/(.+)$/.exec(value.name) : null;
  return named ? { ...value, name: named[2], group: named[1] } : value;
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
  let refused: string | undefined;
  let wasSignedIn = false;
  let lastSent: string | undefined;
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
  // A turn has just ended: what the agent says next is a message of its own, never run on from the last.
  let ended = false;
  /** The call a subagent's update belongs under, as Claude Code tags it or OpenCode marks it. */
  const parentCall = (update: { _meta?: any }): ToolCall | undefined => {
    const tagged = parentOf(update);
    if (tagged) {
      return findCall(items, tagged);
    }
    const child = childOf(update);
    return child && subagentCall(items, child.id, child.title);
  };
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
        lastSent = event.text;
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
            const parent = parentCall(update);
            if (parent) {
              if (parent.subagent && update.sessionUpdate === 'agent_message_chunk') {
                parent.subagent.report += textOf(update.content);
                parent.output = parent.subagent.report;
              }
              break;
            }
            if (childOf(update)) {
              break;
            }
            const kind = update.sessionUpdate === 'agent_message_chunk' ? 'agent' : 'thought';
            const text = textOf(update.content);
            const previous = last();
            if (previous?.kind === kind && !ended) {
              previous.text += text;
            } else if (text !== '') {
              items.push({ kind, text });
            }
            ended = false;
            break;
          }
          case 'tool_call': {
            const call: ToolCall = {
              id: update.toolCallId,
              title: titleOf(
                ownTitle(update) ?? 'Tool',
                locationsOf(update) ?? [],
                update.rawInput
              ),
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
            nameSubagent(call, update);
            const parent = parentCall(update);
            const previous = last();
            if (parent) {
              parent.calls.push(call);
              if (parent.subagent) {
                // What it hands back is what it says after its last call.
                parent.subagent.report = '';
              }
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
              const title = ownTitle(update);
              call.title = title ? titleOf(title, call.locations, update.rawInput) : call.title;
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
              nameSubagent(call, update);
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
      case 'question': {
        const question = event.question;
        if (question?.tool_call_id) {
          asking.set(question.id, question.tool_call_id);
        }
        items.push({
          kind: 'question',
          id: question?.id ?? '',
          message: question?.message || undefined,
          inputs: questionInputs(
            (question?.fields ?? []) as QuestionField[],
            question?.required ?? []
          ),
        });
        break;
      }
      case 'replied': {
        const question = items.find(
          (item) => item.kind === 'question' && item.id === event.question?.id
        );
        asking.delete(event.question?.id ?? '');
        if (question?.kind === 'question') {
          question.reply = {
            action: event.question?.action ?? 'cancel',
            content: event.question?.content,
          };
        }
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
        wasSignedIn ||= account?.signed_in === true;
        break;
      case 'sign_in':
        answering = false;
        signIn = event.sign_in ?? [];
        refused = lastSent;
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
        ended = true;
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
      case 'subagent': {
        const reported = event.subagent;
        const call = reported && subagentCall(items, reported.id, reported.title);
        if (!reported || !call?.subagent) {
          break;
        }
        call.subagent.status = reported.status;
        call.subagent.error = reported.error || undefined;
        // Done after its turn, the agent takes the conversation up again by itself: said, so the reader
        // knows why it speaks.
        if (!answering) {
          const name = subagentName(call.subagent);
          if (reported.status === 'completed') {
            items.push({ kind: 'note', text: `${name} reported back`, failed: false });
          } else if (reported.status === 'failed') {
            const why = reported.error ? `: ${reported.error}` : '';
            items.push({ kind: 'note', text: `${name} failed${why}`, failed: true });
          } else if (reported.status === 'interrupted') {
            items.push({ kind: 'note', text: `${name} stopped`, failed: false });
          }
        }
        break;
      }
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
    refused,
    wasSignedIn,
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
