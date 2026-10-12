import { KeyboardEvent, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';

import {
  AgentChat,
  AgentInfo,
  apiErrorMessage,
  isUntrusted,
  listAgents,
  listChats,
  startChat,
  stopChat,
} from '@/api';
import IconButton from '@/ide/IconButton';
import { Icon, IconName } from '@/ide/icons';
import { agentChatAtom } from '@/store/agents';
import { projectDirAtom } from '@/store/serverInfo';
import { useTabActions } from '@/store/tabActions';
import { useAskTrust } from '@/store/trust';
import { ChatItem, PlanEntry, ToolCall } from './chatLog';
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
  const askTrust = useAskTrust();

  // The agents installed, and a chat already running, rejoined after a reload.
  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch((failure: unknown) => setError(apiErrorMessage(failure)));
    listChats()
      .then((running) => setChat((current) => current ?? running[0] ?? null))
      .catch(() => {});
  }, [setChat]);

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
  };

  return (
    <aside className="agentPanel" hidden={hidden} aria-label="Agent">
      <div className="agentPanel-title">
        <span className="z-label">{chat ? nameOf(chat, agents) : 'Agent'}</span>
        {chat && <IconButton icon="plus" label="New chat" onClick={newChat} />}
      </div>
      {chat ? (
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
    if (text === '' || view.answering || view.exited) {
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
          <span>{connected ? 'Your own agent, your own subscription' : 'Reconnecting…'}</span>
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

  const open = (path: string) => {
    const root = projectDir.endsWith('/') ? projectDir : `${projectDir}/`;
    if (!path.startsWith(root)) {
      return;
    }
    const relative = path.slice(root.length);
    const name = relative.split('/').pop() ?? relative;
    openTab({ name, path: relative, type: name.endsWith('.ipynb') ? 'notebook' : 'file' });
  };

  return (
    <div className="agentTools">
      {calls.map((call) => (
        <button
          type="button"
          key={call.id}
          className="panel-row"
          disabled={call.locations.length === 0}
          title={call.locations[0] ?? call.title}
          onClick={() => call.locations[0] && open(call.locations[0])}
        >
          <Icon name={TOOL_ICONS[call.kind] ?? 'bot'} />
          <span className="panel-row-name">{call.title}</span>
          <span className={`agentTools-status is-${call.status}`}>{statusOf(call.status)}</span>
        </button>
      ))}
    </div>
  );
}

function statusOf(status: string): string {
  switch (status) {
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'in_progress':
      return 'running';
    default:
      return 'waiting';
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
