import {
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
  apiErrorMessage,
  isUntrusted,
  listAgents,
  listChats,
  listPastChats,
  openPastChat,
  PastChat,
  startChat,
  stopChat,
} from '@/api';
import IconButton from '@/ide/IconButton';
import { Icon, IconName } from '@/ide/icons';
import { agentChatAtom } from '@/store/agents';
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
  const [starting, setStarting] = useState<AgentInfo | null>(null);
  const [error, setError] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const askTrust = useAskTrust();

  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch((failure: unknown) => setError(apiErrorMessage(failure)));
  }, []);

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

  const start = async (agent: AgentInfo) => {
    setStarting(agent);
    setError('');
    try {
      setChat(await startChat(agent.id));
    } catch (failure) {
      if (isUntrusted(failure)) {
        askTrust({
          reason: 'other',
          what: `start ${agent.name} in this folder`,
          onTrusted: () => void start(agent),
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
        <Picker agents={agents} starting={starting} error={error} onStart={start} />
      )}
    </aside>
  );
}

function nameOf(chat: AgentChat, agents: AgentInfo[] | null): string {
  return agents?.find((agent) => agent.id === chat.agent)?.name ?? chat.agent;
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
  starting: AgentInfo | null;
  error: string;
  onStart: (agent: AgentInfo) => void;
}) {
  if (props.starting) {
    return (
      <div className="agentPanel-empty">
        <span className="z-spinner" role="status" aria-label="Starting" />
        <p>
          Starting {props.starting.name}. The first time, the agent is downloaded, which can take a
          minute or two.
        </p>
      </div>
    );
  }
  return (
    <div className="agentPanel-empty">
      <p>
        Pick an agent to work in this project. It runs as you, with your own subscription, and can
        read and edit files, and read and run notebooks — asking first.
      </p>
      {props.error && (
        <div className="z-notice z-notice-error">
          <Icon name="circle-alert" size={14} />
          <p>{props.error}</p>
        </div>
      )}
      <div className="agentPanel-agents">
        {(props.agents ?? []).map((agent) => (
          <button
            type="button"
            key={agent.id}
            className="panel-row"
            disabled={!agent.installed}
            title={agent.installed ? `Start ${agent.name}` : agent.hint}
            onClick={() => props.onStart(agent)}
          >
            <Icon name="bot" />
            <span className="panel-row-name">{agent.name}</span>
            <span className="panel-row-meta">{agent.installed ? 'found' : agent.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Conversation({ chat }: { chat: AgentChat }) {
  const { view, connected, prompt, cancel, answer, setMode } = useAgentChat(chat.id);
  const [draft, setDraft] = useState('');
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
    prompt(text);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
          <Item key={index} item={item} onAnswer={answer} />
        ))}
        {view.plan.length > 0 && <Plan entries={view.plan} />}
        {view.answering && (
          <span className="z-spinner agentChat-working" role="status" aria-label="Working" />
        )}
        <div ref={bottom} />
      </div>
      <div className="agentComposer">
        <textarea
          className="z-field"
          value={draft}
          disabled={view.exited}
          placeholder={view.exited ? 'The agent has stopped: start a new chat' : 'Ask the agent'}
          aria-label="Message to the agent"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
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
  item,
  onAnswer,
}: {
  item: ChatItem;
  onAnswer: (id: string, option: string) => void;
}) {
  switch (item.kind) {
    case 'user':
      return <div className="agentMsg is-user">{item.text}</div>;
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
