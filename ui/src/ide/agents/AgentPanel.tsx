import React, {
  ComponentProps,
  createContext,
  KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';

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
  SignInMethod,
  signInRequiredOf,
  signOutChat,
  startChat,
  startCommand,
  stopChat,
  TurnFile,
  undoTurn,
} from '@/api';
import ConfirmDialog from '@/ide/ConfirmDialog';
import IconButton from '@/ide/IconButton';
import { Icon, IconName } from '@/ide/icons';
import { useDismissOnEscape, useDismissOnPressOutside, useMenuKeys } from '@/ide/overlays';
import { MenuSeparator } from '@/ide/statusBar/StatusMenu';
import {
  agentChatAtom,
  agentDocsAtom,
  agentDocTabKey,
  composerMentionsAtom,
  OpenedAgentDoc,
} from '@/store/agents';
import { useFileMatches } from '@/ide/topBar/palette/useFileMatches';
import { useFollowLink, useOpenProjectFile } from './links';
import { fileMention } from './mentions';
import { projectDirAtom } from '@/store/serverInfo';
import { useTabActions } from '@/store/tabActions';
import { useAskTrust } from '@/store/trust';
import { dockOpenAtom, dockTabAtom } from '@/store/languageServers';
import { currentTerminalAtom, typeInTerminalAtom } from '@/store/terminals';
import { lineDiff } from '@/ide/editor/notebookDiff/cellDiff';
import { relativeDate } from '@/ide/sidebar/dates';
import AgentSettings from './AgentSettings';
import {
  AgentCommand,
  AgentDoc,
  AgentSetting,
  ChatItem,
  PlanEntry,
  terminalText,
  ToolCall,
  ToolDiff,
} from './chatLog';
import CommandPicker from './CommandPicker';
import ContextMeter, { tokens } from './ContextMeter';
import QuestionForm from './QuestionForm';
import SignIn from './SignIn';
import { usePickerKeys } from './usePickerKeys';
import { useAgentChat } from './useAgentChat';
import { useChatAnnouncer } from './useChatAnnouncer';
import './AgentPanel.scss';

const MarkdownRenderer = lazy(() => import('@/ide/editor/notebook/MarkdownRenderer'));

/** An agent waiting to be signed in, how it was asked to start, and how far the reader has got. */
interface SignInState {
  target: AgentInfo | string;
  name: string;
  methods: SignInMethod[];
  /** The way being finished in the terminal; none while one is chosen. */
  method?: SignInMethod;
  notice?: { text: string; failed: boolean };
  /** The message the agent would not take, for the field of the chat that starts once signed in. */
  kept?: string;
}

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
  /** The agent starting, how to give up on it, and the way it is signing itself in with, if any. */
  const [starting, setStarting] = useState<{
    name: string;
    abort: AbortController;
    signingIn?: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const historyAnchor = useRef<HTMLSpanElement>(null);
  const closeHistory = useCallback(() => setBrowsing(false), []);
  useDismissOnEscape(closeHistory, browsing);
  useDismissOnPressOutside(historyAnchor, closeHistory, browsing);
  const askTrust = useAskTrust();
  // Here rather than in the conversation, so the head can draw the chat's title and how full it is.
  const live = useAgentChat(chat?.id ?? null);
  const { title, usage } = live.view;
  const [signIn, setSignIn] = useState<SignInState | null>(null);
  const [signingOut, setSigningOut] = useState<'asking' | 'busy' | null>(null);
  const [signOutError, setSignOutError] = useState('');
  // How the chat open now was started, so a sign-in it asks for can start it again.
  const startedWith = useRef<AgentInfo | string | null>(null);
  // What the field of the chat just started begins with: the message refused for want of a sign-in.
  const [firstDraft, setFirstDraft] = useState('');
  const typeInTerminal = useSetAtom(typeInTerminalAtom);
  const setCurrentTerminal = useSetAtom(currentTerminalAtom);
  const setDockTab = useSetAtom(dockTabAtom);
  const setDockOpen = useSetAtom(dockOpenAtom);

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

  /**
   * Starts a known agent, or any other by its command line. An agent that will not start until someone
   * signs in answers how it signs in, which takes the panel; one tried again from there says so when it
   * is still not signed in. With `way`, one the agent carries out itself, it signs in first, with `key`
   * when the way takes one.
   */
  const start = async (target: AgentInfo | string, way?: SignInMethod, key?: string) => {
    const name = typeof target === 'string' ? commandName(target) : target.name;
    const abort = new AbortController();
    setStarting({ name, abort, signingIn: way?.name });
    setError('');
    try {
      setChat(
        await (typeof target === 'string'
          ? startCommand(target, abort.signal, way?.id, key)
          : startChat(target.id, abort.signal, way?.id, key))
      );
      startedWith.current = target;
      setFirstDraft(signIn?.kept ?? '');
      setSignIn(null);
    } catch (failure) {
      const required = signInRequiredOf(failure);
      if (abort.signal.aborted) {
        // Given up on: back to where it was asked from, with nothing to say about it.
      } else if (required !== null && way) {
        setSignIn((current) => ({
          target,
          name,
          methods: required.methods,
          notice: {
            text: required.refused
              ? `${way.name} did not sign ${name} in: ${required.refused}`
              : `${name} is still not signed in.`,
            failed: true,
          },
          kept: current?.kept,
        }));
      } else if (required !== null) {
        setSignIn((current) =>
          current?.method
            ? {
                ...current,
                notice: {
                  text: `${name} is still not signed in. Finish in the terminal, then try again.`,
                  failed: true,
                },
              }
            : {
                target,
                name,
                methods: required.methods,
                notice: current?.notice,
                kept: current?.kept,
              }
        );
      } else if (isUntrusted(failure)) {
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

  /** Ends the chat, and puts the agent's ways of signing in in its place. */
  const toSignIn = useCallback(
    (methods: SignInMethod[], notice: string, kept?: string) => {
      if (chat === null) return;
      const target =
        startedWith.current ?? agents?.find((agent) => agent.id === chat.agent) ?? chat.agent;
      void stopChat(chat.id).catch(() => {});
      setChat(null);
      setBrowsing(false);
      setSignIn({
        target,
        name: nameOf(chat, agents),
        methods,
        notice: { text: notice, failed: false },
        kept,
      });
    },
    [chat, agents, setChat]
  );

  // The agent will not go on until it is signed in: signed out since the chat started, here or anywhere
  // else, or never signed in by an agent that opens a session all the same.
  const { signIn: needsSignIn, refused, wasSignedIn } = live.view;
  useEffect(() => {
    if (needsSignIn !== undefined && chat !== null) {
      const name = nameOf(chat, agents);
      toSignIn(
        needsSignIn,
        (wasSignedIn ? `${name} was signed out.` : `${name} needs to be signed in.`) +
          (refused
            ? ' Your last message was not sent: it will be in the field once you are signed in.'
            : ''),
        refused
      );
    }
  }, [needsSignIn, refused, wasSignedIn, chat, agents, toSignIn]);

  const signOut = async () => {
    if (chat === null) return;
    setSigningOut('busy');
    setSignOutError('');
    try {
      const methods = await signOutChat(chat.id);
      setSigningOut(null);
      toSignIn(methods, `Signed out of ${nameOf(chat, agents)}.`);
    } catch (failure) {
      setSignOutError(apiErrorMessage(failure));
      setSigningOut('asking');
    }
  };

  /**
   * Runs one of the agent's ways of signing in: one it carries out itself as the chat starts, a terminal
   * way in a terminal named for it, with its command typed in.
   */
  const runSignIn = (method: SignInMethod, key?: string) => {
    if (signIn === null) return;
    if (method.kind === 'agent' || !method.command) {
      void start(signIn.target, method, key);
      return;
    }
    typeInTerminal({ name: `Sign in to ${signIn.name}`, line: method.command });
    setSignIn({ ...signIn, method, notice: undefined });
  };

  const showSignInTerminal = () => {
    if (signIn === null) return;
    setCurrentTerminal(`Sign in to ${signIn.name}`);
    setDockTab('terminal');
    setDockOpen(true);
  };

  return (
    <aside className="agentPanel" data-region="agent" hidden={hidden} aria-label="Agent">
      <div className="agentPanel-title">
        <span className="z-label agentPanel-name" title={title}>
          {chat ? (title ?? nameOf(chat, agents)) : (starting?.name ?? signIn?.name ?? 'Agent')}
        </span>
        {chat && (
          <span className="agentPanel-actions">
            {usage && <ContextMeter usage={usage} model={modelName(live.view.settings)} />}
            {chat.history && (
              <span className="agentHistory-anchor" ref={historyAnchor}>
                <IconButton
                  icon="history"
                  label="Past conversations"
                  pressed={browsing}
                  expanded={browsing}
                  onClick={() => setBrowsing((open) => !open)}
                />
                {browsing && <History chatId={chat.id} onClose={closeHistory} />}
              </span>
            )}
            <IconButton icon="plus" label="New chat" onClick={newChat} />
          </span>
        )}
      </div>
      {chat ? (
        <Conversation
          chat={chat}
          live={live}
          agentName={nameOf(chat, agents)}
          firstDraft={firstDraft}
          onSignOut={() => setSigningOut('asking')}
          onSignInWith={(way) => {
            // As the sign-in screen's terminal way: the command typed in, the terminal shown.
            const name = `Sign in to ${nameOf(chat, agents)}`;
            typeInTerminal({ name, line: way.command! });
            setCurrentTerminal(name);
            setDockTab('terminal');
            setDockOpen(true);
          }}
        />
      ) : signIn && !starting ? (
        <SignIn
          name={signIn.name}
          methods={signIn.methods}
          method={signIn.method}
          notice={signIn.notice}
          onSignIn={runSignIn}
          onShowTerminal={showSignInTerminal}
          onTryAgain={() => void start(signIn.target)}
          onChooseAnother={() => setSignIn({ ...signIn, method: undefined, notice: undefined })}
          onBack={() => {
            setSignIn(null);
            setFirstDraft('');
          }}
        />
      ) : (
        <Picker
          agents={agents}
          starting={starting?.name ?? null}
          signingIn={starting?.signingIn}
          onCancel={() => starting?.abort.abort()}
          error={error}
          onStart={(target) => void start(target)}
          onCheckAgain={findAgents}
        />
      )}
      {signingOut !== null && chat !== null && (
        <ConfirmDialog
          title={`Sign out of ${nameOf(chat, agents)}?`}
          confirmLabel="Sign out"
          busyLabel="Signing out…"
          busy={signingOut === 'busy'}
          onConfirm={() => void signOut()}
          onCancel={() => {
            setSigningOut(null);
            setSignOutError('');
          }}
        >
          {signOutError && <p className="z-notice-error">{signOutError}</p>}
          <p>
            This signs {nameOf(chat, agents)} out everywhere on this computer, not only here, and
            ends this chat.
            {chat.kept_key && ` Zasper forgets the ${chat.kept_key} it kept.`} You can sign in again
            from the panel.
          </p>
        </ConfirmDialog>
      )}
    </aside>
  );
}

/** The model the agent is on, by the name it gives it. */
function modelName(settings: AgentSetting[]): string | undefined {
  const model = settings.find((setting) => setting.category === 'model');
  if (model?.kind !== 'choice') return undefined;
  return model.values.find((value) => value.value === model.value)?.name ?? model.value;
}

function nameOf(chat: AgentChat, agents: AgentInfo[] | null): string {
  return agents?.find((agent) => agent.id === chat.agent)?.name ?? commandName(chat.agent);
}

/** What a command line runs, by the program's own name rather than its whole path. */
function commandName(command: string): string {
  const program = command.trim().split(/\s+/)[0] ?? command;
  return program.split('/').pop() || program;
}

/**
 * The agent's past conversations in the project, as a menu over the conversation; picking one goes on in
 * it. The list is fetched each time the menu opens, since the agent keeps it.
 */
function History({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [past, setPast] = useState<PastChat[] | null>(null);
  const [next, setNext] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState('');
  const list = useRef<HTMLUListElement | null>(null);
  // Where the focus goes once more have come: Show more, which had it, is gone.
  const [focusFrom, setFocusFrom] = useState<number | null>(null);
  const menuKeys = useMenuKeys(onClose);
  const menuRef = menuKeys.ref;
  const listRef = useCallback(
    (element: HTMLUListElement | null) => {
      list.current = element;
      menuRef(element);
    },
    [menuRef]
  );

  const load = useCallback(
    (cursor: string) =>
      listPastChats(chatId, cursor)
        .then((page) => {
          setPast((previous) => {
            const kept = cursor ? (previous ?? []) : [];
            if (cursor) setFocusFrom(kept.length);
            return [...kept, ...page.chats];
          });
          setNext(page.next);
        })
        .catch((failure: unknown) => setError(apiErrorMessage(failure))),
    [chatId]
  );

  useEffect(() => {
    void load('');
  }, [load]);

  useEffect(() => {
    if (focusFrom === null) return;
    list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[focusFrom]?.focus();
    setFocusFrom(null);
  }, [focusFrom, past]);

  const open = async (id: string, title?: string) => {
    setOpening(id);
    setError('');
    try {
      await openPastChat(chatId, id, title);
      onClose();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="z-overlay z-menu agentHistory">
      {error && (
        <div className="z-notice z-notice-error">
          <Icon name="circle-alert" size={14} />
          <p>{error}</p>
        </div>
      )}
      {past === null && !error && <span className="z-spinner" role="status" aria-label="Loading" />}
      {past?.length === 0 && (
        <p className="agentHistory-empty">No past conversations in this project.</p>
      )}
      {past !== null && past.length > 0 && (
        <ul
          className="z-overlay-list"
          role="menu"
          aria-label="Past conversations"
          {...menuKeys}
          ref={listRef}
        >
          {past.map((chat) => (
            <li
              key={chat.id}
              className={chat.current ? 'panel-row is-selected' : 'panel-row'}
              role="none"
            >
              <button
                type="button"
                className="panel-row-name"
                role="menuitem"
                disabled={chat.current || opening !== null}
                title={[chat.title, chat.updated && new Date(chat.updated).toLocaleString()]
                  .filter(Boolean)
                  .join(' · ')}
                onClick={() => void open(chat.id, chat.title)}
              >
                {opening === chat.id ? (
                  <span className="z-spinner" role="status" aria-label="Opening" />
                ) : (
                  <Icon name="history" />
                )}
                <span className="panel-row-label">{chat.title || 'Untitled'}</span>
                <span className="panel-row-meta">
                  {chat.current ? 'open now' : chat.updated ? relativeDate(chat.updated) : ''}
                </span>
              </button>
            </li>
          ))}
          {next && (
            <>
              <MenuSeparator />
              {/* A row like the conversations', its chevron where their clocks are. */}
              <li className="panel-row" role="none">
                <button
                  type="button"
                  className="panel-row-name"
                  role="menuitem"
                  disabled={opening !== null}
                  onClick={() => void load(next)}
                >
                  <Icon name="chevron-down" />
                  <span className="panel-row-label">Show more</span>
                </button>
              </li>
            </>
          )}
        </ul>
      )}
    </div>
  );
}

// After this long a start is worth explaining: an agent fetched by npx downloads itself the first time.
const SLOW_START_SECONDS = 5;

/**
 * An agent on its way up: the server says nothing until it is, so this counts the time rather than steps.
 * One signing itself in with `signingIn` may be waiting on the reader in the browser.
 */
function Starting({
  name,
  signingIn,
  onCancel,
}: {
  name: string;
  signingIn?: string;
  onCancel: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const began = Date.now();
    const tick = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - began) / 1000)),
      1000
    );
    return () => window.clearInterval(tick);
  }, []);

  if (signingIn) {
    return (
      <div className="agentStarting" role="status" aria-label={`Signing in to ${name}`}>
        <span className="agentStarting-mark">
          <Icon name="key-round" size={20} />
        </span>
        <h3 className="z-subheading">Signing in to {name}</h3>
        <div className="z-meter is-indeterminate agentStarting-meter">
          <span />
        </div>
        <p className="agentStarting-why">
          {signingIn} may continue in your browser. The chat starts here when it is done.
        </p>
        <button type="button" className="z-button z-button-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="agentStarting" role="status" aria-label={`Starting ${name}`}>
      <span className="agentStarting-mark">
        <Icon name="bot" size={20} />
      </span>
      <h3 className="z-subheading">Starting {name}</h3>
      <div className="z-meter is-indeterminate agentStarting-meter">
        <span />
      </div>
      <p className="agentStarting-time">
        {seconds < 1 ? 'Opening a session in this project' : `${seconds}s`}
      </p>
      {seconds >= SLOW_START_SECONDS && (
        <p className="agentStarting-why">
          The first start downloads the agent, which can take a minute or two. After that it opens
          in seconds.
        </p>
      )}
      <button type="button" className="z-button z-button-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function Picker(props: {
  agents: AgentInfo[] | null;
  /** The name of the agent starting. */
  starting: string | null;
  /** The way it is signing itself in with, if any. */
  signingIn?: string;
  error: string;
  onStart: (target: AgentInfo | string) => void;
  onCheckAgain: () => void;
  onCancel: () => void;
}) {
  const [command, setCommand] = useState('');
  if (props.starting) {
    return <Starting name={props.starting} signingIn={props.signingIn} onCancel={props.onCancel} />;
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

function Conversation({
  chat,
  live,
  agentName,
  firstDraft,
  onSignOut,
  onSignInWith,
}: {
  chat: AgentChat;
  live: ReturnType<typeof useAgentChat>;
  agentName: string;
  firstDraft: string;
  onSignOut: () => void;
  onSignInWith: (way: SignInMethod) => void;
}) {
  const { view, connected, prompt, cancel, answer, reply, setMode, setSetting } = live;
  const [settingOpen, setSettingOpen] = useState<string | null>(null);
  const docs = useChatDocs(chat.id, agentName, view.docs);
  const announcement = useChatAnnouncer(view);
  const [draft, setDraft] = useState(firstDraft);
  const [mentions, setMentions] = useAtom(composerMentionsAtom);
  // What is being looked for in a list above the field: a file after an @, a command after a / at the start.
  const [picking, setPicking] = useState<{ kind: 'file' | 'command'; query: string } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [view]);

  const steers = chat.steers === true;
  const send = () => {
    const text = draft.trim();
    // Not before the chat's socket is open: what was typed would go nowhere. While the agent works,
    // only to one that takes it into the turn it is on.
    if (text === '' || (view.answering && !steers) || view.exited || !connected) {
      return;
    }
    prompt(text, mentions);
    setDraft('');
    setMentions([]);
    setPicking(null);
  };

  // A word being typed after an @ is a file to find; one after a / that starts the message, a command.
  const typed = (text: string, caret: number) => {
    const command = /^\/(\S*)$/.exec(text.slice(0, caret));
    if (command && view.commands.length > 0) {
      setPicking({ kind: 'command', query: command[1] });
      return;
    }
    const word = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    setPicking(word ? { kind: 'file', query: word[1] } : null);
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

  // In the field rather than sent, so what it takes can follow.
  const pickCommand = (command: AgentCommand) => {
    const caret = field.current?.selectionStart ?? draft.length;
    setDraft(`/${command.name} ${draft.slice(caret).trimStart()}`);
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
    <DocsContext.Provider value={docs}>
      <div className="z-visually-hidden" role="status">
        {announcement}
      </div>
      <div className="agentChat">
        {view.items.map((item, index) => (
          <Item chatId={chat.id} key={index} item={item} onAnswer={answer} onReply={reply} />
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
        {picking?.kind === 'file' && (
          <FilePicker query={picking.query} onPick={pick} field={field} />
        )}
        {picking?.kind === 'command' && (
          <CommandPicker
            commands={view.commands}
            query={picking.query}
            onPick={pickCommand}
            field={field}
          />
        )}
        <textarea
          ref={field}
          className="z-field"
          value={draft}
          disabled={view.exited}
          placeholder={
            view.exited
              ? 'The agent has stopped: start a new chat'
              : view.commands.length > 0
                ? 'Ask the agent — @ for a file, / for a command'
                : 'Ask the agent — @ for a file'
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
          {connected ? (
            <AgentSettings
              agent={chat.agent}
              settings={view.settings}
              mode={view.mode}
              disabled={view.exited}
              open={settingOpen}
              onOpen={setSettingOpen}
              onSet={setSetting}
              onSetMode={setMode}
              agentName={agentName}
              account={view.account}
              canSignOut={chat.can_sign_out === true && view.account?.signed_in !== false}
              onSignOut={onSignOut}
              signInWays={chat.sign_in_ways}
              onSignInWith={onSignInWith}
            />
          ) : (
            <span>Connecting…</span>
          )}
          <span
            className={
              view.answering && steers ? 'agentComposer-actions is-pair' : 'agentComposer-actions'
            }
          >
            {view.answering &&
              (steers ? (
                <button
                  type="button"
                  className="z-button z-button-secondary"
                  aria-label="Stop"
                  title="Stop"
                  onClick={cancel}
                >
                  <Icon name="circle-stop" size={14} />
                </button>
              ) : (
                <button type="button" className="z-button z-button-secondary" onClick={cancel}>
                  <Icon name="circle-stop" size={14} /> Stop
                </button>
              ))}
            {(!view.answering || steers) && (
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
          </span>
        </div>
      </div>
    </DocsContext.Provider>
  );
}

/** The documents the agent wrote for the reader in this chat, and how to open one in its tab. */
interface ChatDocs {
  docs: AgentDoc[];
  /** Opens the document at this path in its tab; false when the agent wrote none there. */
  open: (path: string) => boolean;
}

const DocsContext = createContext<ChatDocs>({ docs: [], open: () => false });

/**
 * The chat's documents, kept in agentDocsAtom for their tabs as the agent writes them again, and a way to
 * open one. A tab reads the text from there: the file is the agent's, outside the project.
 */
function useChatDocs(chatId: string, agent: string, docs: AgentDoc[]): ChatDocs {
  const setDocs = useSetAtom(agentDocsAtom);
  const { openTab } = useTabActions();
  useEffect(() => {
    setDocs((previous) => {
      const changed = docs.filter((doc) => {
        const kept = previous[agentDocTabKey(chatId, doc.path)];
        return kept?.text !== doc.text || kept.agent !== agent;
      });
      if (changed.length === 0) {
        return previous;
      }
      const next: Record<string, OpenedAgentDoc> = { ...previous };
      for (const doc of changed) {
        next[agentDocTabKey(chatId, doc.path)] = { agent, name: doc.name, text: doc.text };
      }
      return next;
    });
  }, [chatId, agent, docs, setDocs]);
  return {
    docs,
    open: (path: string) => {
      const doc = docs.find((candidate) => candidate.path === path);
      if (doc !== undefined) {
        openTab({ name: doc.name, path: agentDocTabKey(chatId, path), type: 'agent-doc' });
      }
      return doc !== undefined;
    },
  };
}

function Item({
  chatId,
  item,
  onAnswer,
  onReply,
}: {
  chatId: string;
  item: ChatItem;
  onAnswer: (id: string, option: string) => void;
  onReply: ComponentProps<typeof QuestionForm>['onReply'];
}) {
  const followLink = useFollowLink(useContext(DocsContext).open);
  switch (item.kind) {
    case 'user':
      return (
        <div className="agentMsg is-user">
          <UserText text={item.text} mentions={item.mentions} />
        </div>
      );
    case 'agent':
      return (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the links inside are what is pressed, and Enter on one is a click that reaches here
        <div className="agentMsg" onClick={followLink}>
          <Suspense fallback={<p>{item.text}</p>}>
            {/* An answer about fares quotes prices; single dollars are money here, not maths. */}
            <MarkdownRenderer source={item.text} singleDollarMath={false} fileLinks />
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
          {/* The change asked for, while it is still the reader's to allow; after, its row has it. */}
          {item.answer === undefined && item.diffs.length > 0 && <AskedChange diffs={item.diffs} />}
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
    case 'question':
      return <QuestionForm item={item} onReply={onReply} />;
    case 'note':
      return <p className={item.failed ? 'agentNote is-failed' : 'agentNote'}>{item.text}</p>;
    case 'notice':
      return (
        <p className={item.severity === 'error' ? 'agentNotice is-error' : 'agentNotice'}>
          <Icon name={NOTICE_ICONS[item.severity]} size={12} />
          <span>
            {item.title}
            {item.description && (
              <>
                {' '}
                <UserText text={item.description} mentions={[]} />
              </>
            )}
          </span>
        </p>
      );
    case 'compaction': {
      const counted =
        item.before !== undefined && item.after !== undefined
          ? ` · ${tokens(item.before)} → ${tokens(item.after)} tokens`
          : '';
      const line = (
        <>
          <Icon name="scroll-text" size={12} />
          <span>
            {COMPACTION_SAID[item.status] ?? 'Conversation compacted'}
            {counted}
          </span>
        </>
      );
      // Folded, as a thought is: the summary is the agent's, and long.
      return item.summary ? (
        <details className="agentFold">
          <summary>{line}</summary>
          <p>{item.summary}</p>
        </details>
      ) : (
        <p className="agentNotice">{line}</p>
      );
    }
    case 'changes':
      return (
        <TurnChanges chatId={chatId} turn={item.turn} files={item.files} undone={item.undone} />
      );
  }
}

const NOTICE_ICONS: Record<'info' | 'warning' | 'error', IconName> = {
  info: 'info',
  warning: 'triangle-alert',
  error: 'circle-alert',
};

const COMPACTION_SAID: Record<string, string> = {
  in_progress: 'Compacting the conversation…',
  completed: 'Conversation compacted',
  failed: 'The conversation could not be compacted',
  cancelled: 'Compacting was stopped',
};

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
  // A command the message starts with, in the face it is typed in.
  const command = /^\/[\w:.-]+(?=\s|$)/.exec(text)?.[0];
  const parts = text.slice(command?.length ?? 0).split(/(@[^\s@]+)/);
  return (
    <>
      {command && <span className="agentCommand">{command}</span>}
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
  field: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const matches = useFileMatches(props.query, true, true).slice(0, PICKER_SIZE);
  const { onPick } = props;
  const chosen = usePickerKeys(
    props.field,
    matches.length,
    (index) => onPick(matches[index].path),
    props.query
  );

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
  /** The files changed after the turn, and which files the undo asked over them was for. */
  const [changedSince, setChangedSince] = useState<{ files: string[]; asked?: string[] } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const undo = async (anyway: boolean, paths?: string[]) => {
    setBusy(true);
    setError('');
    try {
      await undoTurn(props.chatId, props.turn, anyway, paths);
      setChangedSince(null);
    } catch (failure) {
      const changed = failure instanceof ApiError ? changedIn(failure) : null;
      if (changed !== null) {
        setChangedSince({ files: changed, asked: paths });
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
          <div key={file.path} className={file.undone ? 'panel-row is-undone' : 'panel-row'}>
            <span className={`agentChanges-status is-${file.status}`}>{file.status}</span>
            <button
              type="button"
              className="panel-row-name"
              title={`${file.path}: what the turn ${STATUS_NAMES[file.status] ?? 'changed'}`}
              onClick={() =>
                openDiff({ path: file.path, turn: { chat: props.chatId, turn: props.turn } })
              }
            >
              <span className="panel-row-label">{file.path}</span>
            </button>
            <span className="panel-row-actions">
              {file.undone ? (
                <span className="agentChanges-undone">undone</span>
              ) : (
                <IconButton
                  icon="undo-2"
                  className="panel-row-action"
                  label={`Undo the turn’s change to ${file.path}`}
                  disabled={busy || changedSince !== null}
                  onClick={() => void undo(false, [file.path])}
                />
              )}
            </span>
          </div>
        ))}
      </div>
      {changedSince !== null && (
        <div className="z-notice">
          <p>
            {changedSince.files.join(', ')} changed after this turn. Undoing puts{' '}
            {changedSince.files.length === 1 ? 'it' : 'them'} back as before the turn, and those
            later changes are lost.
          </p>
          <span className="agentAsk-actions">
            <button
              type="button"
              className="z-button"
              onClick={() => void undo(true, changedSince.asked)}
            >
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

/** The change a permission prompt asks to make, drawn as a tool's diff is. */
function AskedChange({ diffs }: { diffs: ToolDiff[] }) {
  const openFile = useOpenProjectFile();
  return (
    <div className="agentTools-output is-asked">
      {diffs.map((diff) => (
        <Diff key={diff.path} diff={diff} onOpen={() => openFile(diff.path)} />
      ))}
    </div>
  );
}

function Tools({ calls }: { calls: ToolCall[] }) {
  const openFile = useOpenProjectFile();
  const { open: openDoc } = useContext(DocsContext);
  const written = allCallsOf(calls).filter((call) => call.doc !== undefined);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // A subagent's calls follow the call that started it, indented under it.
  const row = (call: ToolCall, nested: boolean): React.ReactNode => {
    const hasOutput =
      call.output !== '' || call.diffs.length > 0 || (call.terminal?.output ?? '') !== '';
    const expanded = open.has(call.id);
    const status = statusOf(call);
    return (
      <React.Fragment key={call.id}>
        <div>
          <button
            type="button"
            className={nested ? 'panel-row is-nested' : 'panel-row'}
            disabled={!hasOutput && call.locations.length === 0}
            aria-expanded={hasOutput && !call.doc ? expanded : undefined}
            title={call.locations[0] ?? call.title}
            onClick={() =>
              call.doc
                ? openDoc(call.doc.path)
                : hasOutput
                  ? toggle(call.id)
                  : call.locations[0] && openFile(call.locations[0])
            }
          >
            <Icon
              name={
                call.calls.length > 0 || call.subagent ? 'bot' : (TOOL_ICONS[call.kind] ?? 'bot')
              }
            />
            <span className="panel-row-name">{call.title}</span>
            <span className={`agentTools-status is-${status.tone}`}>{status.label}</span>
            {hasOutput && !call.doc && (
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className="z-icon-sm" />
            )}
          </button>
          {expanded && <ToolOutput call={call} openFile={openFile} />}
        </div>
        {call.calls.map((child) => row(child, true))}
      </React.Fragment>
    );
  };

  return (
    <>
      <div className="agentTools">{calls.map((call) => row(call, false))}</div>
      {/* A document written for the reader, by its name, opened in a tab of its own. */}
      {written.map((call) => (
        <button
          type="button"
          key={call.id}
          className="agentDocLink"
          aria-label={`Open ${call.doc!.name}`}
          onClick={() => openDoc(call.doc!.path)}
        >
          <Icon name="scroll-text" size={14} />
          <span className="agentDocLink-name">{call.doc!.name}</span>
          <span className="agentDocLink-open">Open</span>
        </button>
      ))}
    </>
  );
}

/** Every call, those a subagent made under the call that started it included. */
function allCallsOf(calls: ToolCall[]): ToolCall[] {
  return calls.flatMap((call) => [call, ...allCallsOf(call.calls)]);
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
  // A subagent goes on after the call that sent it off has answered, and says how it is doing itself.
  switch (call.subagent?.status) {
    case 'created':
    case 'running':
      return call.status === 'completed'
        ? { label: 'in the background', tone: 'in_progress' }
        : { label: 'running', tone: 'in_progress' };
    case 'failed':
      return { label: 'failed', tone: 'failed' };
    case 'interrupted':
      return { label: 'stopped', tone: 'failed' };
  }
  const exit = call.terminal?.exit;
  if (exit?.signal) {
    return { label: `stopped (${exit.signal})`, tone: 'failed' };
  }
  if (exit?.code) {
    return { label: `exit ${exit.code}`, tone: 'failed' };
  }
  // The call has answered, and the command goes on without the agent.
  if (call.background && call.status !== 'failed' && call.terminal?.exit === undefined) {
    return { label: 'in the background', tone: 'in_progress' };
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
