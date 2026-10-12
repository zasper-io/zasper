import React, {
  KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue } from 'jotai';

import {
  AgentChat,
  AgentInfo,
  ApiError,
  apiErrorMessage,
  isUntrusted,
  Mention,
  listAgents,
  listChats,
  listPastChats,
  openPastChat,
  PastChat,
  startChat,
  startCommand,
  stopChat,
  TurnFile,
  undoTurn,
} from '@/api';
import IconButton from '@/ide/IconButton';
import { Icon, IconName } from '@/ide/icons';
import { agentChatAtom, composerMentionsAtom } from '@/store/agents';
import { useFileMatches } from '@/ide/topBar/palette/useFileMatches';
import { fileMention } from './mentions';
import { projectDirAtom } from '@/store/serverInfo';
import { useTabActions } from '@/store/tabActions';
import { useAskTrust } from '@/store/trust';
import { lineDiff } from '@/ide/editor/notebookDiff/cellDiff';
import { relativeDate } from '@/ide/sidebar/dates';
import { ChatItem, PlanEntry, terminalText, ToolCall, ToolDiff } from './chatLog';
import { useAgentChat } from './useAgentChat';
import './AgentPanel.scss';

const MarkdownRenderer = lazy(() => import('@/ide/editor/notebook/MarkdownRenderer'));

const TOOL_ICONS: Record<string, IconName> = {
  read: 'file',
  edit: 'pencil',
  delete: 'trash-2',
  move: 'file',
  search: 'search',
  execute: 'terminal',
  think: 'lightbulb',
  fetch: 'refresh-cw',
};

/**
 * The agent panel: a coding agent the user already has, started in the project and talked to here. The
 * conversation is the server's, so this draws a chat that may have been going on in another tab, or
 * with no tab at all. See docs/AGENTS.md.
 */
export default function AgentPanel({ hidden }: { hidden: boolean }) {
  const [chat, setChat] = useAtom(agentChatAtom);
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  /** The name of the agent starting. */
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const askTrust = useAskTrust();

  const findAgents = useCallback(() => {
    listAgents()
      .then(setAgents)
      .catch((failure: unknown) => setError(apiErrorMessage(failure)));
  }, []);
  useEffect(findAgents, [findAgents]);

  /*
   * A chat already running is rejoined: after a reload, and when one was started in another tab, which
   * this one hears of when the panel is opened or the window comes back to the front.
   */
  const hasChat = chat !== null;
  useEffect(() => {
    if (hidden || hasChat) {
      return;
    }
    const rejoin = () =>
      listChats()
        .then((running) => setChat((current) => current ?? running[0] ?? null))
        .catch(() => {});
    void rejoin();
    window.addEventListener('focus', rejoin);
    return () => window.removeEventListener('focus', rejoin);
  }, [hidden, hasChat, setChat]);

  /** Starts a known agent, or any other by its command line. */
  const start = async (target: AgentInfo | string) => {
    const name = typeof target === 'string' ? commandName(target) : target.name;
    setStarting(name);
    setError('');
    try {
      setChat(await (typeof target === 'string' ? startCommand(target) : startChat(target.id)));
    } catch (failure) {
      if (isUntrusted(failure)) {
        askTrust({
          reason: 'other',
          what: `start ${name} in this folder`,
          onTrusted: () => void start(target),
        });
      } else {
        setError(apiErrorMessage(failure));
      }
    } finally {
      setStarting(null);
    }
  };

  const newChat = () => {
    if (chat) {
      void stopChat(chat.id).catch(() => {});
    }
    setChat(null);
    setBrowsing(false);
  };

  return (
    <aside className="agentPanel" hidden={hidden} aria-label="Agent">
      <div className="agentPanel-title">
        <span className="z-label">{chat ? nameOf(chat, agents) : 'Agent'}</span>
        {chat && (
          <span className="agentPanel-actions">
            {chat.history && (
              <IconButton
                icon="history"
                label="Past conversations"
                pressed={browsing}
                onClick={() => setBrowsing((open) => !open)}
              />
            )}
            <IconButton icon="plus" label="New chat" onClick={newChat} />
          </span>
        )}
      </div>
      {chat && browsing ? (
        <History chatId={chat.id} onOpened={() => setBrowsing(false)} />
      ) : chat ? (
        <Conversation chat={chat} />
      ) : (
        <Picker
          agents={agents}
          starting={starting}
          error={error}
          onStart={(target) => void start(target)}
          onCheckAgain={findAgents}
        />
      )}
    </aside>
  );
}

function nameOf(chat: AgentChat, agents: AgentInfo[] | null): string {
  return agents?.find((agent) => agent.id === chat.agent)?.name ?? commandName(chat.agent);
}

/** What a command line runs, by the program's own name rather than its whole path. */
function commandName(command: string): string {
  const program = command.trim().split(/\s+/)[0] ?? command;
  return program.split('/').pop() || program;
}

/** The agent's past conversations in the project; picking one goes on in it. */
function History({ chatId, onOpened }: { chatId: string; onOpened: () => void }) {
  const [past, setPast] = useState<PastChat[] | null>(null);
  const [next, setNext] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(
    (cursor: string) =>
      listPastChats(chatId, cursor)
        .then((page) => {
          setPast((previous) => [...(cursor ? (previous ?? []) : []), ...page.chats]);
          setNext(page.next);
        })
        .catch((failure: unknown) => setError(apiErrorMessage(failure))),
    [chatId]
  );

  useEffect(() => {
    void load('');
  }, [load]);

  const open = async (id: string) => {
    setOpening(id);
    setError('');
    try {
      await openPastChat(chatId, id);
      onOpened();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="agentPanel-empty">
      {error && (
        <div className="z-notice z-notice-error">
          <Icon name="circle-alert" size={14} />
          <p>{error}</p>
        </div>
      )}
      {past === null && !error && <span className="z-spinner" role="status" aria-label="Loading" />}
      {past?.length === 0 && <p>No past conversations in this project.</p>}
      {past !== null && past.length > 0 && (
        <div className="agentPanel-agents agentHistory" aria-label="Past conversations">
          {past.map((chat) => (
            <button
              type="button"
              key={chat.id}
              className="panel-row"
              disabled={chat.current || opening !== null}
              title={[chat.title, chat.updated && new Date(chat.updated).toLocaleString()]
                .filter(Boolean)
                .join(' · ')}
              onClick={() => void open(chat.id)}
            >
              {opening === chat.id ? (
                <span className="z-spinner" role="status" aria-label="Opening" />
              ) : (
                <Icon name="history" />
              )}
              <span className="panel-row-name">{chat.title || 'Untitled'}</span>
              <span className="panel-row-meta">
                {chat.current ? 'open now' : chat.updated ? relativeDate(chat.updated) : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      {next && (
        <button
          type="button"
          className="z-button z-button-secondary"
          onClick={() => void load(next)}
        >
          Show more
        </button>
      )}
    </div>
  );
}

function Picker(props: {
  agents: AgentInfo[] | null;
  /** The name of the agent starting. */
  starting: string | null;
  error: string;
  onStart: (target: AgentInfo | string) => void;
  onCheckAgain: () => void;
}) {
  const [command, setCommand] = useState('');
  if (props.starting) {
    return (
      <div className="agentStart">
        <div className="agentStart-starting">
          <span className="z-spinner" role="status" aria-label="Starting" />
          <div>
            <h3 className="z-subheading">Starting {props.starting}</h3>
            <p>The first start downloads the agent, which can take a minute or two.</p>
          </div>
        </div>
      </div>
    );
  }
  const ready = (props.agents ?? []).filter((agent) => agent.installed);
  const missing = (props.agents ?? []).filter((agent) => !agent.installed);
  return (
    <div className="agentStart">
      <div className="agentStart-intro">
        <h3 className="z-subheading">Work with an agent</h3>
        <p>
          A coding agent you already use, working in this project. It asks before it changes
          anything.
        </p>
      </div>
      {props.error && (
        <div className="z-notice z-notice-error">
          <Icon name="circle-alert" size={14} />
          <p>{props.error}</p>
        </div>
      )}
      {props.agents === null && !props.error && (
        <span className="z-spinner" role="status" aria-label="Finding agents" />
      )}
      {ready.length > 0 && (
        <section className="agentStart-section" aria-label="Ready">
          <div className="z-label">Ready</div>
          {ready.map((agent) => (
            <div key={agent.id} className="agentCard">
              <div className="agentCard-head">
                <div className="agentCard-name">
                  <strong>{agent.name}</strong>
                  <span>{agent.vendor}</span>
                </div>
                <button
                  type="button"
                  className="z-button"
                  aria-label={`Start ${agent.name}`}
                  onClick={() => props.onStart(agent)}
                >
                  Start
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {missing.length > 0 && (
        <section className="agentStart-section" aria-label="Not installed">
          <div className="z-label">Not installed</div>
          {missing.map((agent) => (
            <div key={agent.id} className="agentCard">
              <div className="agentCard-name">
                <strong>{agent.name}</strong>
                <span>{agent.vendor}</span>
              </div>
              <div className="agentCard-install">
                <code>{agent.install}</code>
                <IconButton
                  icon="copy"
                  label={`Copy the command that installs ${agent.name}`}
                  onClick={() => void navigator.clipboard?.writeText(agent.install)}
                />
              </div>
              <p className="z-form-help">{agent.then}</p>
            </div>
          ))}
          <button
            type="button"
            className="z-button z-button-secondary"
            onClick={props.onCheckAgain}
          >
            Check again
          </button>
        </section>
      )}
      <details className="agentStart-other">
        <summary>Use another ACP agent</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (command.trim() !== '') props.onStart(command.trim());
          }}
        >
          <input
            className="z-field"
            value={command}
            placeholder="my-agent --acp"
            aria-label="The command that starts the agent"
            onChange={(event) => setCommand(event.target.value)}
          />
          <button
            type="submit"
            className="z-button z-button-secondary"
            disabled={command.trim() === ''}
          >
            Start
          </button>
        </form>
      </details>
      <p className="agentStart-foot">
        Runs as you, on your own subscription. Zasper stores none of it.
      </p>
    </div>
  );
}

function Conversation({ chat }: { chat: AgentChat }) {
  const { view, connected, prompt, cancel, answer, setMode } = useAgentChat(chat.id);
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useAtom(composerMentionsAtom);
  const [picking, setPicking] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [view]);

  const send = () => {
    const text = draft.trim();
    // Not before the chat's socket is open: what was typed would go nowhere.
    if (text === '' || view.answering || view.exited || !connected) {
      return;
    }
    prompt(text, mentions);
    setDraft('');
    setMentions([]);
  };

  // A word being typed after an @ is a file to find.
  const typed = (text: string, caret: number) => {
    const word = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    setPicking(word ? word[1] : null);
  };

  const pick = (path: string) => {
    const caret = field.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@[^\s@]*$/, `@${path} `);
    setDraft(before + draft.slice(caret));
    setMentions((current) => [
      ...current.filter((each) => each.path !== path || each.kind !== 'file'),
      fileMention(path),
    ]);
    setPicking(null);
    field.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (picking !== null && event.key === 'Escape') {
      event.preventDefault();
      setPicking(null);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <>
      <div className="agentPanel-mode z-select">
        <select
          aria-label="What the agent may do without asking"
          value={view.mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="ask">Ask every time</option>
          <option value="edits">Allow edits</option>
          <option value="all">Allow edits and commands</option>
        </select>
      </div>
      <div className="agentChat" aria-live="polite">
        {view.items.map((item, index) => (
          <Item chatId={chat.id} key={index} item={item} onAnswer={answer} />
        ))}
        {view.plan.length > 0 && <Plan entries={view.plan} />}
        {view.answering && (
          <span className="z-spinner agentChat-working" role="status" aria-label="Working" />
        )}
        <div ref={bottom} />
      </div>
      <div className="agentComposer">
        {mentions.length > 0 && (
          <div className="agentComposer-context" aria-label="Mentioned">
            {mentions.map((mention) => (
              <MentionChip
                key={`${mention.kind}:${mention.path}:${mention.cell_id ?? ''}`}
                mention={mention}
                onRemove={() =>
                  setMentions((current) => current.filter((each) => each !== mention))
                }
              />
            ))}
          </div>
        )}
        {picking !== null && (
          <FilePicker
            query={picking}
            onPick={pick}
            onClose={() => setPicking(null)}
            field={field}
          />
        )}
        <textarea
          ref={field}
          className="z-field"
          value={draft}
          disabled={view.exited}
          placeholder={
            view.exited ? 'The agent has stopped: start a new chat' : 'Ask the agent — @ for a file'
          }
          aria-label="Message to the agent"
          onChange={(event) => {
            setDraft(event.target.value);
            typed(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setPicking(null)}
        />
        <div className="agentComposer-foot">
          <span>{connected ? 'Your own agent, your own subscription' : 'Connecting…'}</span>
          {view.answering ? (
            <button type="button" className="z-button z-button-secondary" onClick={cancel}>
              <Icon name="circle-stop" size={14} /> Stop
            </button>
          ) : (
            <button
              type="button"
              className="z-button"
              aria-label="Send"
              disabled={draft.trim() === '' || view.exited || !connected}
              onClick={send}
            >
              <Icon name="arrow-up" size={14} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Item({
  chatId,
  item,
  onAnswer,
}: {
  chatId: string;
  item: ChatItem;
  onAnswer: (id: string, option: string) => void;
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="agentMsg is-user">
          <UserText text={item.text} mentions={item.mentions} />
        </div>
      );
    case 'agent':
      return (
        <div className="agentMsg">
          <Suspense fallback={<p>{item.text}</p>}>
            <MarkdownRenderer source={item.text} />
          </Suspense>
        </div>
      );
    case 'thought':
      return (
        <details className="agentThought">
          <summary>Thinking</summary>
          <p>{item.text}</p>
        </details>
      );
    case 'tools':
      return <Tools calls={item.calls} />;
    case 'permission':
      return (
        <div className="agentAsk">
          <p>
            <strong>{item.title}</strong>
          </p>
          {item.answer === undefined ? (
            <div className="agentAsk-actions">
              {item.options.map((option) => (
                <button
                  type="button"
                  key={option.optionId}
                  className={
                    option.kind.startsWith('allow') && option === item.options[0]
                      ? 'z-button'
                      : 'z-button z-button-secondary'
                  }
                  onClick={() => onAnswer(item.id, option.optionId)}
                >
                  {option.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="agentAsk-answer">
              {item.answer === null
                ? 'Withdrawn.'
                : item.auto
                  ? 'Allowed by this chat’s mode.'
                  : `${item.options.find((option) => option.optionId === item.answer)?.name ?? item.answer}.`}
            </p>
          )}
        </div>
      );
    case 'note':
      return <p className={item.failed ? 'agentNote is-failed' : 'agentNote'}>{item.text}</p>;
    case 'changes':
      return (
        <TurnChanges chatId={chatId} turn={item.turn} files={item.files} undone={item.undone} />
      );
  }
}

const MENTION_ICONS: Record<Mention['kind'], IconName> = {
  file: 'file',
  cell: 'file-code',
  output: 'scroll-text',
};

function MentionChip({ mention, onRemove }: { mention: Mention; onRemove?: () => void }) {
  return (
    <span className="agentRef" title={mention.path}>
      <Icon name={MENTION_ICONS[mention.kind]} size={12} />
      {mention.label}
      {onRemove && (
        <button type="button" aria-label={`Remove ${mention.label}`} onClick={onRemove}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}

/**
 * A sent message, a file it mentions drawn as a chip where its @path stands, and a cell or an output,
 * which have no place in the text, as chips before it.
 */
function UserText({ text, mentions }: { text: string; mentions: Mention[] }) {
  const files = new Map(
    mentions.filter((each) => each.kind === 'file').map((each) => [each.path, each])
  );
  const apart = mentions.filter((each) => each.kind !== 'file' || !text.includes(`@${each.path}`));
  const parts = text.split(/(@[^\s@]+)/);
  return (
    <>
      {apart.length > 0 && (
        <span className="agentMsg-refs">
          {apart.map((mention) => (
            <MentionChip
              key={`${mention.kind}:${mention.path}:${mention.cell_id ?? ''}`}
              mention={mention}
            />
          ))}
        </span>
      )}
      {parts.map((part, index) => {
        const file = part.startsWith('@') ? files.get(part.slice(1)) : undefined;
        return file ? <MentionChip key={index} mention={file} /> : part;
      })}
    </>
  );
}

const PICKER_SIZE = 8;

/** The files whose names match what follows an @, to pick one with the keyboard or the pointer. */
function FilePicker(props: {
  query: string;
  onPick: (path: string) => void;
  onClose: () => void;
  field: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const matches = useFileMatches(props.query, true).slice(0, PICKER_SIZE);
  const [chosen, setChosen] = useState(0);
  const { onPick, onClose } = props;

  useEffect(() => setChosen(0), [props.query]);

  // The field keeps the keyboard; the keys that move through the list are taken from it.
  useEffect(() => {
    const element = props.field.current;
    if (element === null) {
      return;
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (matches.length === 0) {
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setChosen((current) => (current + step + matches.length) % matches.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onPick(matches[chosen].path);
      }
    };
    element.addEventListener('keydown', onKey, { capture: true });
    return () => element.removeEventListener('keydown', onKey, { capture: true });
  }, [props.field, matches, chosen, onPick, onClose]);

  return (
    <div className="agentPicker" role="listbox" aria-label="Files to mention">
      {props.query === '' ? (
        <p className="agentPicker-hint">Type part of a file’s name</p>
      ) : matches.length === 0 ? (
        <p className="agentPicker-hint">No file is called that</p>
      ) : (
        matches.map((match, index) => (
          <button
            type="button"
            role="option"
            key={match.path}
            aria-selected={index === chosen}
            className={match.ignored ? 'panel-row is-ignored' : 'panel-row'}
            // Before the field's blur, which would close the list under the pointer.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(match.path);
            }}
          >
            <Icon name="file" />
            <span className="panel-row-name">{match.name}</span>
            <span className="panel-row-meta">{match.path}</span>
          </button>
        ))
      )}
    </div>
  );
}

const STATUS_NAMES: Record<string, string> = { A: 'added', M: 'changed', D: 'deleted' };

/** The files a turn changed, each opening its before and after, and the turn's undo. */
function TurnChanges(props: { chatId: string; turn: number; files: TurnFile[]; undone: boolean }) {
  const { openDiff } = useTabActions();
  const [changedSince, setChangedSince] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const undo = async (anyway: boolean) => {
    setBusy(true);
    setError('');
    try {
      await undoTurn(props.chatId, props.turn, anyway);
      setChangedSince(null);
    } catch (failure) {
      const changed = failure instanceof ApiError ? changedIn(failure) : null;
      if (changed !== null) {
        setChangedSince(changed);
      } else {
        setError(apiErrorMessage(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  const count = props.files.length;
  return (
    <div className="agentChanges">
      <div className="agentChanges-head">
        <span>{count === 1 ? '1 file changed' : `${count} files changed`}</span>
        {props.undone ? (
          <span className="agentChanges-undone">Undone</span>
        ) : (
          <button
            type="button"
            className="z-button z-button-secondary"
            disabled={busy || changedSince !== null}
            onClick={() => void undo(false)}
          >
            Undo this turn
          </button>
        )}
      </div>
      <div className="agentTools">
        {props.files.map((file) => (
          <button
            type="button"
            key={file.path}
            className="panel-row"
            title={`${file.path}: what the turn ${STATUS_NAMES[file.status] ?? 'changed'}`}
            onClick={() =>
              openDiff({ path: file.path, turn: { chat: props.chatId, turn: props.turn } })
            }
          >
            <span className={`agentChanges-status is-${file.status}`}>{file.status}</span>
            <span className="panel-row-name">{file.path}</span>
          </button>
        ))}
      </div>
      {changedSince !== null && (
        <div className="z-notice">
          <p>
            {changedSince.join(', ')} changed after this turn. Undoing puts{' '}
            {changedSince.length === 1 ? 'it' : 'them'} back as before the turn, and those later
            changes are lost.
          </p>
          <span className="agentAsk-actions">
            <button type="button" className="z-button" onClick={() => void undo(true)}>
              Undo anyway
            </button>
            <button
              type="button"
              className="z-button z-button-secondary"
              onClick={() => setChangedSince(null)}
            >
              Keep them
            </button>
          </span>
        </div>
      )}
      {error && (
        <div className="z-notice z-notice-error">
          <Icon name="circle-alert" size={14} />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}

/** The files a refused undo names as changed since the turn, or null for any other refusal. */
function changedIn(failure: ApiError): string[] | null {
  if (failure.status !== 409) {
    return null;
  }
  try {
    const body = JSON.parse(failure.body) as { changed?: unknown };
    return Array.isArray(body.changed) ? (body.changed as string[]) : null;
  } catch {
    return null;
  }
}

function Tools({ calls }: { calls: ToolCall[] }) {
  const { openTab } = useTabActions();
  const projectDir = useAtomValue(projectDirAtom);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const openFile = (path: string) => {
    const root = projectDir.endsWith('/') ? projectDir : `${projectDir}/`;
    if (!path.startsWith(root)) {
      return;
    }
    const relative = path.slice(root.length);
    const name = relative.split('/').pop() ?? relative;
    openTab({ name, path: relative, type: name.endsWith('.ipynb') ? 'notebook' : 'file' });
  };

  const toggle = (id: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="agentTools">
      {calls.map((call) => {
        const hasOutput =
          call.output !== '' || call.diffs.length > 0 || (call.terminal?.output ?? '') !== '';
        const expanded = open.has(call.id);
        const status = statusOf(call);
        return (
          <div key={call.id}>
            <button
              type="button"
              className="panel-row"
              disabled={!hasOutput && call.locations.length === 0}
              aria-expanded={hasOutput ? expanded : undefined}
              title={call.locations[0] ?? call.title}
              onClick={() =>
                hasOutput ? toggle(call.id) : call.locations[0] && openFile(call.locations[0])
              }
            >
              <Icon name={TOOL_ICONS[call.kind] ?? 'bot'} />
              <span className="panel-row-name">{call.title}</span>
              <span className={`agentTools-status is-${status.tone}`}>{status.label}</span>
              {hasOutput && (
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className="z-icon-sm" />
              )}
            </button>
            {expanded && <ToolOutput call={call} openFile={openFile} />}
          </div>
        );
      })}
    </div>
  );
}

function ToolOutput({ call, openFile }: { call: ToolCall; openFile: (path: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const printed = call.terminal?.output ?? '';
  const running = call.terminal !== undefined && call.terminal.exit === undefined;
  // A command still running is followed as it prints, unless the reader has scrolled up to read.
  const following = useRef(true);
  useLayoutEffect(() => {
    const element = box.current;
    if (element !== null && running && following.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [printed, running]);

  return (
    <div
      ref={box}
      className="agentTools-output"
      onScroll={(event) => {
        const element = event.currentTarget;
        following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
      }}
    >
      {call.diffs.map((diff) => (
        <Diff key={diff.path} diff={diff} onOpen={() => openFile(diff.path)} />
      ))}
      {call.output !== '' && <pre>{call.output}</pre>}
      {printed !== '' && (
        <pre>
          {call.terminal?.cut && <span className="agentTools-cut">Earlier output not shown</span>}
          {terminalText(printed)}
        </pre>
      )}
    </div>
  );
}

function Diff({ diff, onOpen }: { diff: ToolDiff; onOpen: () => void }) {
  const lines = lineDiff(diff.oldText ?? '', diff.newText);
  return (
    <div className="agentDiff">
      <button type="button" className="agentDiff-file" onClick={onOpen}>
        {diff.path.split('/').pop()}
        {diff.oldText === null && ' (new)'}
      </button>
      <pre>
        {lines
          .filter((line) => line.kind !== 'same')
          .map((line, index) => (
            <span key={index} className={`agentDiff-line is-${line.kind}`}>
              {line.kind === 'added' ? '+ ' : '− '}
              {line.text}
            </span>
          ))}
      </pre>
    </div>
  );
}

/** What a row says of its call, and the colour it says it in: a command says how it ended. */
function statusOf(call: ToolCall): { label: string; tone: string } {
  const exit = call.terminal?.exit;
  if (exit?.signal) {
    return { label: `stopped (${exit.signal})`, tone: 'failed' };
  }
  if (exit?.code) {
    return { label: `exit ${exit.code}`, tone: 'failed' };
  }
  switch (call.status) {
    case 'completed':
      return { label: 'done', tone: call.status };
    case 'failed':
      return { label: 'failed', tone: call.status };
    case 'in_progress':
      return {
        label: call.elapsedSeconds ? `running ${Math.round(call.elapsedSeconds)}s` : 'running',
        tone: call.status,
      };
    default:
      return { label: 'waiting', tone: call.status };
  }
}

function Plan({ entries }: { entries: PlanEntry[] }) {
  return (
    <ul className="agentPlan" aria-label="The agent's plan">
      {entries.map((entry, index) => (
        <li key={index} className={`is-${entry.status}`}>
          {entry.status === 'completed' ? (
            <Icon name="check" size={12} />
          ) : entry.status === 'in_progress' ? (
            <span className="z-spinner" />
          ) : (
            <span className="agentPlan-dot" />
          )}
          {entry.content}
        </li>
      ))}
    </ul>
  );
}
