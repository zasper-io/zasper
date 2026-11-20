import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api';
import { Provider } from '@/testing/Provider';
import AgentPanel from './AgentPanel';
import { cellMention, useAddMention } from './mentions';
import { useAtomValue } from 'jotai';
import { terminalInputAtom } from '@/store/terminals';
import { fileTabsAtom } from '@/store/tabState';

const listAgents = vi.fn();
const listChats = vi.fn();
const startChat = vi.fn();
const startCommand = vi.fn();
const listPastChats = vi.fn();
const openPastChat = vi.fn();
const undoTurn = vi.fn();
const searchFiles = vi.fn();
const signOutChat = vi.fn();

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  listAgents: () => listAgents(),
  listChats: () => listChats(),
  startChat: (agent: string, signal?: AbortSignal, signIn?: string, key?: string) =>
    signIn === undefined
      ? startChat(agent, signal)
      : key === undefined
        ? startChat(agent, signal, signIn)
        : startChat(agent, signal, signIn, key),
  startCommand: (command: string) => startCommand(command),
  stopChat: () => Promise.resolve(),
  listPastChats: (chatId: string, cursor?: string) => listPastChats(chatId, cursor),
  openPastChat: (chatId: string, id: string, title?: string) => openPastChat(chatId, id, title),
  undoTurn: (chatId: string, turn: number, anyway?: boolean, paths?: string[]) =>
    undoTurn(chatId, turn, anyway, paths),
  searchFiles: (query: string, ignored?: boolean, inPaths?: boolean) =>
    searchFiles(query, ignored, inPaths),
  signOutChat: (id: string) => signOutChat(id),
}));

/** What is waiting to be typed into each terminal. */
function Pending() {
  return <pre data-testid="pending">{JSON.stringify(useAtomValue(terminalInputAtom))}</pre>;
}

// Plain text, with a Markdown link drawn as the link it renders as, so a press on one can be tested.
vi.mock('@/ide/editor/notebook/MarkdownRenderer', () => ({
  default: ({ source }: { source: string }) => (
    <p>
      {source.split(/(\[[^\]]+\]\([^)]+\))/).map((part, index) => {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        return link ? (
          <a key={index} href={link[2]}>
            {link[1]}
          </a>
        ) : (
          part
        );
      })}
    </p>
  ),
}));

/** The tabs open, as type and name. */
function OpenTabs() {
  const tabs = useAtomValue(fileTabsAtom);
  return (
    <pre data-testid="tabs">
      {JSON.stringify(Object.values(tabs).map((tab) => `${tab.type}:${tab.name}`))}
    </pre>
  );
}

/** The chat's socket: what the server sends is pushed by hand, and what the panel sends is kept. */
class FakeSocket {
  static latest: FakeSocket;
  static OPEN = 1;
  /** Off for a test that has to hold the socket unopened. */
  static autoOpen = true;
  readyState = 1;
  sent: Record<string, string>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.latest = this;
    if (FakeSocket.autoOpen) {
      setTimeout(() => this.onopen?.(), 0);
    }
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  push(event: object) {
    act(() => this.onmessage?.({ data: JSON.stringify(event) }));
  }
}

vi.stubGlobal('WebSocket', FakeSocket);

// Zasper's own mode, the one setting a chat with an agent that sends none has: there once connected.
const ZASPER_MODE = 'What the agent may do without asking: Ask every time';

const said = (text: string) => ({
  type: 'update',
  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
});

describe('AgentPanel', () => {
  beforeEach(() => {
    FakeSocket.autoOpen = true;
    listAgents.mockResolvedValue([
      {
        id: 'claude-code',
        name: 'Claude Code',
        vendor: 'Anthropic',
        installed: true,
        install: 'npm i claude',
        then: 'Sign in.',
      },
      {
        id: 'codex',
        name: 'Codex',
        vendor: 'OpenAI',
        installed: false,
        install: 'npm install -g codex-acp',
        then: 'Sign in once by running codex.',
      },
    ]);
    startCommand.mockResolvedValue({ id: 'chat-2', agent: '/opt/bin/my-agent' });
    listChats.mockResolvedValue([]);
    startChat.mockResolvedValue({ id: 'chat-1', agent: 'claude-code' });
  });

  it('offers the agents installed, and how to install the others', async () => {
    render(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );

    const claude = await screen.findByRole('button', { name: 'Start Claude Code' });
    expect(claude).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Start Codex' })).not.toBeInTheDocument();
    const missing = screen.getByRole('region', { name: 'Not installed' });
    expect(missing).toHaveTextContent('npm install -g codex-acp');
    expect(missing).toHaveTextContent('Sign in once by running codex.');
  });

  it('shows an agent starting, and gives up on it when asked', async () => {
    let signal: AbortSignal | undefined;
    startChat.mockImplementationOnce(
      (_agent: string, given?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = given;
          given?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );
    render(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));

    expect(await screen.findByRole('status', { name: 'Starting Claude Code' })).toBeInTheDocument();
    expect(screen.getByText('Claude Code', { selector: '.z-label' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(signal?.aborted).toBe(true);
    expect(await screen.findByRole('button', { name: 'Start Claude Code' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('starts any other agent by the command that runs it, and names it by its program', async () => {
    render(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );
    fireEvent.click(await screen.findByText('Use another ACP agent'));
    fireEvent.change(screen.getByLabelText('The command that starts the agent'), {
      target: { value: ' /opt/bin/my-agent --acp ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(startCommand).toHaveBeenCalledWith('/opt/bin/my-agent --acp'));
    expect(await screen.findByText('my-agent')).toBeInTheDocument();
  });

  it('joins a chat started in another tab when it is opened', async () => {
    listChats.mockClear();
    const view = render(
      <Provider>
        <AgentPanel hidden />
      </Provider>
    );
    await act(async () => {});
    expect(listChats).not.toHaveBeenCalled();
    listChats.mockResolvedValue([{ id: 'chat-9', agent: 'claude-code' }]);

    view.rerender(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );

    await waitFor(() => expect(FakeSocket.latest?.url).toContain('/ws/agents/chats/chat-9'));
  });

  it('joins a chat started elsewhere when the window comes back to the front', async () => {
    render(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );
    await screen.findByRole('button', { name: 'Start Claude Code' });
    listChats.mockResolvedValue([{ id: 'chat-9', agent: 'claude-code' }]);

    fireEvent.focus(window);

    await waitFor(() => expect(FakeSocket.latest?.url).toContain('/ws/agents/chats/chat-9'));
  });

  it('starts a chat, draws what the agent says, and sends the reader’s answers', async () => {
    render(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
    await waitFor(() => expect(FakeSocket.latest?.url).toContain('/ws/agents/chats/chat-1'));
    // Connected: until then the server has not sent the log, and opening starts it again.
    await screen.findByRole('button', { name: ZASPER_MODE });

    const socket = FakeSocket.latest;
    socket.push({ type: 'user', text: 'Change THRESHOLD' });
    socket.push(said('Let me'));
    socket.push(said(' look.'));
    socket.push({
      type: 'permission',
      permission: {
        id: 'q1',
        request: {
          toolCall: { title: 'Edit prepare.py' },
          options: [
            { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
            { optionId: 'no', name: 'No', kind: 'reject_once' },
          ],
        },
      },
    });

    // Drawn first as plain text while the markdown renderer loads, then by it.
    await waitFor(() => expect(screen.getByText('Let me look.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(socket.sent).toContainEqual({ type: 'answer', id: 'q1', option_id: 'yes' });

    socket.push({ type: 'answered', permission: { id: 'q1', option_id: 'yes' } });
    socket.push({ type: 'turn_end', stop_reason: 'end_turn' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Message to the agent'), {
      target: { value: 'thanks' },
    });
    fireEvent.keyDown(screen.getByLabelText('Message to the agent'), { key: 'Enter' });
    expect(socket.sent).toContainEqual({ type: 'prompt', text: 'thanks', mentions: [] });
  });

  describe('a message while the agent works', () => {
    async function working(chat: { id: string; agent: string; steers?: boolean }) {
      startChat.mockResolvedValueOnce(chat);
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      await waitFor(() => expect(FakeSocket.latest?.url).toContain(`/ws/agents/chats/${chat.id}`));
      await screen.findByRole('button', { name: ZASPER_MODE });
      const socket = FakeSocket.latest;
      socket.push({ type: 'user', text: 'Write a story' });
      socket.push(said('Once upon a time'));
      await screen.findByRole('button', { name: 'Stop' });
      fireEvent.change(screen.getByLabelText('Message to the agent'), {
        target: { value: 'make it shorter' },
      });
      return socket;
    }

    it('goes to an agent that steers, with Send beside Stop', async () => {
      const socket = await working({ id: 'chat-s', agent: 'antigravity', steers: true });

      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
      fireEvent.keyDown(screen.getByLabelText('Message to the agent'), { key: 'Enter' });

      expect(socket.sent).toContainEqual({ type: 'prompt', text: 'make it shorter', mentions: [] });
      expect(screen.getByLabelText('Message to the agent')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('waits for the turn to end with one that does not', async () => {
      const socket = await working({ id: 'chat-n', agent: 'claude-code' });

      expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
      fireEvent.keyDown(screen.getByLabelText('Message to the agent'), { key: 'Enter' });

      expect(socket.sent.filter((message: any) => message.type === 'prompt')).toEqual([]);
      expect(screen.getByLabelText('Message to the agent')).toHaveValue('make it shorter');
    });
  });

  describe('a document the agent wrote for the reader', () => {
    const PLAN = '/home/u/.gemini/antigravity-cli/brain/s1/plan.md';
    const written = {
      type: 'update',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'w',
        title: `File ../../../../${PLAN.slice(1)}`,
        kind: 'edit',
        status: 'completed',
        locations: [{ path: PLAN }],
        rawInput: {
          Path: PLAN,
          Content: '# Plan\n\n1. Change greet.',
          ArtifactMetadata: { UserFacing: true, RequestFeedback: true },
        },
      },
    };
    const tabs = () => JSON.parse(screen.getByTestId('tabs').textContent!);

    async function wrote(answer: string) {
      render(
        <Provider>
          <AgentPanel hidden={false} />
          <OpenTabs />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      await screen.findByRole('button', { name: ZASPER_MODE });
      const socket = FakeSocket.latest;
      socket.push({ type: 'user', text: 'plan it' });
      socket.push(written);
      socket.push(said(answer));
      socket.push({ type: 'turn_end', stop_reason: 'end_turn' });
      await screen.findByRole('button', { name: 'Open plan.md' });
    }

    it('is a link under the write, which opens it in a read-only tab', async () => {
      await wrote('Here is the plan.');

      expect(screen.getByText('File plan.md')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Open plan.md' }));

      expect(tabs()).toContain('agent-doc:plan.md');
    });

    it('opens from the agent’s own link to it, and a link to a web page leaves for a new tab', async () => {
      const opened = vi.spyOn(window, 'open').mockReturnValue(null);
      await wrote(`See [plan.md](file://${PLAN}) and [the docs](https://example.com/docs).`);

      fireEvent.click(screen.getByRole('link', { name: 'plan.md' }));
      expect(tabs()).toContain('agent-doc:plan.md');

      fireEvent.click(screen.getByRole('link', { name: 'the docs' }));
      expect(opened).toHaveBeenCalledWith(
        'https://example.com/docs',
        '_blank',
        'noopener,noreferrer'
      );
      opened.mockRestore();
    });
  });

  it('shows the change an edit asks to make until it is answered', async () => {
    render(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
    await screen.findByRole('button', { name: ZASPER_MODE });
    const socket = FakeSocket.latest;
    socket.push({ type: 'user', text: 'add a line' });
    socket.push({
      type: 'permission',
      permission: {
        id: 'q1',
        request: {
          toolCall: {
            title: 'File hello.py',
            content: [
              {
                type: 'diff',
                path: '/p/hello.py',
                oldText: 'print("world")',
                newText: 'print("world")\nprint("zasper")',
              },
            ],
          },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        },
      },
    });

    const ask = await screen.findByText('File hello.py', { selector: 'strong' });
    const prompt = ask.closest('.agentAsk') as HTMLElement;
    expect(prompt).toHaveTextContent('hello.py+ print("zasper")');
    expect(prompt.querySelector('.agentDiff-line.is-added')).toHaveTextContent('+ print("zasper")');

    socket.push({ type: 'answered', permission: { id: 'q1', option_id: 'allow' } });
    await waitFor(() => expect(prompt).toHaveTextContent('Allow.'));
    expect(prompt.querySelector('.agentDiff')).toBeNull();
  });

  describe('the agent’s settings', () => {
    const choice = (id: string, category: string | null, current: string, ...values: string[]) => ({
      id,
      name: id[0].toUpperCase() + id.slice(1),
      category,
      type: 'select',
      currentValue: current,
      options: values.map((value) => ({
        value,
        name: value[0].toUpperCase() + value.slice(1),
        description: `The ${value} one`,
      })),
    });
    const settings = {
      type: 'settings',
      settings: [
        choice('mode', 'mode', 'plan', 'default', 'plan'),
        choice('model', 'model', 'large', 'large', 'small'),
        choice('effort', 'thought_level', 'high', 'low', 'high'),
        choice('fast', null, 'off', 'off', 'on'),
      ],
    };

    const connect = async () => {
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      await screen.findByRole('button', { name: ZASPER_MODE });
      return FakeSocket.latest;
    };

    it('names a model by its own name, under its provider once there is more than one', async () => {
      const socket = await connect();
      const models = (...names: string[]) => ({
        type: 'settings',
        settings: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'opencode/big-pickle',
            options: names.map((name) => ({ value: name.toLowerCase().replace(/ /g, '-'), name })),
          },
        ],
      });

      socket.push(models('opencode/Beam Free', 'opencode/Big Pickle'));
      fireEvent.click(await screen.findByRole('button', { name: 'Model: Big Pickle' }));
      let menu = screen.getByRole('menu', { name: 'Model' });
      expect(
        within(menu)
          .getAllByRole('menuitemradio')
          .map((item) => item.textContent)
      ).toEqual(['Beam Free', 'Big Pickle']);
      expect(within(menu).queryByText('opencode')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Model: Big Pickle' }));

      socket.push(models('opencode/Big Pickle', 'anthropic/Claude Sonnet 5.5'));
      fireEvent.click(await screen.findByRole('button', { name: 'Model: Big Pickle' }));
      menu = screen.getByRole('menu', { name: 'Model' });
      expect(within(menu).getByText('opencode')).toBeInTheDocument();
      expect(within(menu).getByText('anthropic')).toBeInTheDocument();
      expect(
        within(menu).getByRole('menuitemradio', { name: 'Claude Sonnet 5.5' })
      ).toBeInTheDocument();
    });

    it('offers an agent’s sign-in under More when it opens a session without one', async () => {
      startChat.mockResolvedValueOnce({
        id: 'chat-1',
        agent: 'opencode',
        sign_in_ways: [
          {
            id: 'opencode-login',
            name: 'Login with opencode',
            kind: 'terminal',
            command: 'opencode acp --login',
          },
        ],
      });
      render(
        <Provider>
          <AgentPanel hidden={false} />
          <Pending />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      await screen.findByRole('button', { name: ZASPER_MODE });

      fireEvent.click(screen.getByRole('button', { name: /^More settings for/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Login with opencode in a terminal' }));

      expect(Object.values(JSON.parse(screen.getByTestId('pending').textContent!))).toEqual([
        ['opencode acp --login\r'],
      ]);
    });

    it('draws a chip for the model, the effort and the mode, in that order, and the rest under More', async () => {
      const socket = await connect();
      socket.push(settings);

      const chips = screen
        .getAllByRole('button', { name: /^(Model|Effort|Mode):/ })
        .map((chip) => chip.getAttribute('aria-label'));
      expect(chips).toEqual(['Model: Large', 'Effort: High', 'Mode: Plan']);
      expect(screen.queryByRole('button', { name: ZASPER_MODE })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'More settings for Claude Code' }));
      const more = screen.getByRole('menu', { name: 'More settings for Claude Code' });
      expect(more).toHaveTextContent('Fast');
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'On' }));
      expect(socket.sent).toContainEqual({ type: 'setting', id: 'fast', value: 'on' });
    });

    it('sends the value picked, and shows what the agent answers', async () => {
      const socket = await connect();
      socket.push(settings);

      fireEvent.click(screen.getByRole('button', { name: 'Model: Large' }));
      expect(
        screen.getByRole('menuitemradio', { name: 'Small The small one' })
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Small The small one' }));
      expect(socket.sent).toContainEqual({ type: 'setting', id: 'model', value: 'small' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      // Not until the agent says so.
      expect(screen.getByRole('button', { name: 'Model: Large' })).toBeInTheDocument();

      socket.push({
        type: 'settings',
        settings: [
          choice('mode', 'mode', 'plan', 'default', 'plan'),
          choice('model', 'model', 'small', 'large', 'small'),
        ],
      });
      expect(screen.getByRole('button', { name: 'Model: Small' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Effort/ })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'More settings for Claude Code' })
      ).not.toBeInTheDocument();
    });

    it('says what the chosen mode does, in the agent’s words', async () => {
      const socket = await connect();
      socket.push(settings);

      fireEvent.click(screen.getByRole('button', { name: 'Mode: Plan' }));

      expect(screen.getByRole('menu', { name: 'Mode' }).parentElement).toHaveTextContent(
        'The plan one'
      );
      expect(screen.getByRole('button', { name: 'Mode: Plan' })).toHaveClass('is-plan');
    });

    it('keeps Zasper’s own mode for an agent with none of its own', async () => {
      const socket = await connect();

      fireEvent.click(screen.getByRole('button', { name: ZASPER_MODE }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Allow edits' }));

      expect(socket.sent).toContainEqual({ type: 'mode', mode: 'edits' });
    });

    it('heads the panel with the chat’s title once the agent names it', async () => {
      const socket = await connect();
      expect(screen.getByText('Claude Code', { selector: '.z-label' })).toBeInTheDocument();

      socket.push({
        type: 'update',
        update: { sessionUpdate: 'session_info_update', title: 'Sensor drift model' },
      });

      expect(screen.getByText('Sensor drift model', { selector: '.z-label' })).toBeInTheDocument();
    });

    it('shows how full the context is, and opens what it is made of', async () => {
      const socket = await connect();
      expect(screen.queryByRole('button', { name: /^Context:/ })).not.toBeInTheDocument();
      socket.push(settings);

      socket.push({
        type: 'update',
        update: { sessionUpdate: 'usage_update', used: 76000, size: 200000 },
      });
      const meter = screen.getByRole('button', { name: 'Context: 38% full' });
      expect(meter).not.toHaveClass('is-high');
      fireEvent.click(meter);
      const detail = screen.getByRole('dialog', { name: 'Context' });
      expect(detail).toHaveTextContent('76k of 200k tokens');
      expect(detail).toHaveTextContent('ModelLarge');
      expect(detail).not.toHaveTextContent('Cost');

      socket.push({
        type: 'update',
        update: {
          sessionUpdate: 'usage_update',
          used: 182000,
          size: 200000,
          cost: { amount: 1.92, currency: 'USD' },
        },
      });
      expect(screen.getByRole('button', { name: 'Context: 91% full' })).toHaveClass('is-high');
      expect(screen.getByRole('dialog', { name: 'Context and cost' })).toHaveTextContent(
        'Cost of this chat$1.92'
      );
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('the agent’s commands', () => {
    const commands = {
      type: 'update',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'compact', description: 'Summarise the conversation so far' },
          { name: 'context', description: 'What is using the context' },
          { name: 'review', description: 'Review a pull request' },
        ],
      },
    };

    const connect = async () => {
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      await screen.findByRole('button', { name: ZASPER_MODE });
      return FakeSocket.latest;
    };
    const type = (text: string) => {
      const field = screen.getByLabelText('Message to the agent') as HTMLTextAreaElement;
      fireEvent.change(field, { target: { value: text, selectionStart: text.length } });
      return field;
    };

    it('lists them after a / that starts the message, and puts the one picked in the field', async () => {
      const socket = await connect();
      socket.push(commands);
      expect(screen.getByLabelText('Message to the agent')).toHaveAttribute(
        'placeholder',
        'Ask the agent — @ for a file, / for a command'
      );

      const field = type('/con');
      screen.getByRole('listbox', { name: 'Commands' });
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        '/contextWhat is using the context',
      ]);

      fireEvent.keyDown(field, { key: 'Enter' });
      expect(field.value).toBe('/context ');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(socket.sent.filter((message) => message.type === 'prompt')).toEqual([]);

      fireEvent.keyDown(field, { key: 'Enter' });
      expect(socket.sent).toContainEqual({ type: 'prompt', text: '/context', mentions: [] });
    });

    it('draws a notice as one quiet line, and a compaction folded with its summary inside', async () => {
      const socket = await connect();
      socket.push(commands);
      socket.push({
        type: 'update',
        update: {
          sessionUpdate: 'notice',
          severity: 'warning',
          title: 'Auto mode is not available',
          description: 'The chat is in Manual.',
        },
      });
      socket.push({
        type: 'update',
        update: { sessionUpdate: 'usage_update', used: 182000, size: 200000 },
      });
      socket.push({
        type: 'update',
        update: { sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'in_progress' },
      });
      expect(screen.getByText('Compacting the conversation…')).toBeInTheDocument();
      socket.push({
        type: 'update',
        update: {
          sessionUpdate: 'compaction_update',
          compactionId: 'c1',
          status: 'completed',
          summary: [{ type: 'text', text: 'Fitted a drift per sensor.' }],
        },
      });
      socket.push({
        type: 'update',
        update: { sessionUpdate: 'usage_update', used: 18000, size: 200000 },
      });

      expect(
        screen.getByText('Auto mode is not available The chat is in Manual.').closest('p')
      ).toHaveClass('agentNotice');
      expect(
        screen.getByText(/The context is 91% full\./).closest('.agentNotice')
      ).toHaveTextContent('The context is 91% full. /compact summarises the conversation so far.');
      expect(
        screen.getByText('/compact', { selector: '.agentNotice .agentCommand' })
      ).toBeInTheDocument();
      const fold = screen.getByText(/Conversation compacted/).closest('details');
      expect(fold).toHaveTextContent('Conversation compacted · 182k → 18k tokens');
      expect(fold).toHaveTextContent('Fitted a drift per sensor.');
      expect(fold).not.toHaveAttribute('open');
    });

    it('draws a subagent’s calls under its row, and a command left running as such', async () => {
      const socket = await connect();
      const update = (update: object) => socket.push({ type: 'update', update });
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'task',
        title: 'Explore',
        kind: 'think',
        status: 'in_progress',
      });
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'g',
        title: 'grep calibrat',
        kind: 'search',
        status: 'completed',
        _meta: { claudeCode: { parentToolUseId: 'task' } },
      });
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'bg',
        title: 'python load_raw.py --all',
        kind: 'execute',
        status: 'completed',
        rawInput: { run_in_background: true },
      });

      const task = screen.getByText('Explore').closest('button');
      const grep = screen.getByText('grep calibrat').closest('button');
      expect(task).not.toHaveClass('is-nested');
      expect(grep).toHaveClass('is-nested');
      expect(task!.compareDocumentPosition(grep!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByText('python load_raw.py --all').closest('button')).toHaveTextContent(
        'in the background'
      );
    });

    it('draws a sent command in the face it is typed in', async () => {
      const socket = await connect();
      socket.push({ type: 'user', text: '/review 42' });

      expect(screen.getByText('/review')).toHaveClass('agentCommand');
    });

    it('opens no list for an agent with none, nor for a / later in the message', async () => {
      const socket = await connect();
      type('/');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

      socket.push(commands);
      type('see /com');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('signing in', () => {
    const WAYS = [
      {
        id: 'claude-ai-login',
        name: 'Claude Subscription',
        description: 'Use Claude subscription',
        kind: 'terminal',
        command: 'claude-agent-acp --cli auth login --claudeai',
      },
      {
        id: 'console-login',
        name: 'Anthropic Console',
        description: 'Use Anthropic Console (API usage billing)',
        kind: 'terminal',
        command: 'claude-agent-acp --cli auth login --console',
      },
    ];
    const refused = (methods: object[] = WAYS, refusal?: string) =>
      new ApiError(
        'POST',
        '/api/agents/chats',
        403,
        JSON.stringify({
          error: 'sign_in_required',
          message: 'needs signing in',
          methods,
          refused: refusal,
        })
      );
    const BY_AGENT = [
      { id: 'oauth-personal', name: 'Log in with Google', kind: 'agent' },
      { id: 'gemini-api-key', name: 'Gemini API key', kind: 'agent' },
    ];

    it('starts the chat with a way the agent carries out, waiting on it as it signs in', async () => {
      let signedIn: (chat: object) => void = () => {};
      startChat
        .mockRejectedValueOnce(refused(BY_AGENT))
        .mockImplementationOnce(() => new Promise((resolve) => (signedIn = resolve)));
      render(
        <Provider>
          <AgentPanel hidden={false} />
          <Pending />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));

      fireEvent.click(
        await screen.findByRole('button', { name: 'Sign in with Log in with Google' })
      );

      const waiting = await screen.findByRole('status', { name: 'Signing in to Claude Code' });
      expect(waiting).toHaveTextContent('Log in with Google may continue in your browser.');
      expect(startChat).toHaveBeenLastCalledWith(
        'claude-code',
        expect.anything(),
        'oauth-personal'
      );
      expect(JSON.parse(screen.getByTestId('pending').textContent!)).toEqual({});

      signedIn({ id: 'chat-1', agent: 'claude-code' });
      expect(await screen.findByRole('button', { name: ZASPER_MODE })).toBeInTheDocument();
    });

    it('says why the agent did not sign itself in, and offers the ways again', async () => {
      startChat
        .mockRejectedValueOnce(refused(BY_AGENT))
        .mockRejectedValueOnce(refused(BY_AGENT, 'GEMINI_API_KEY is not set.'));
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));

      fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Gemini API key' }));

      expect(
        await screen.findByText(
          'Gemini API key did not sign Claude Code in: GEMINI_API_KEY is not set.'
        )
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Sign in with Log in with Google' })
      ).toBeInTheDocument();
    });

    it('asks for the key in the card of a way that takes one, and starts with it', async () => {
      startChat
        .mockRejectedValueOnce(
          refused([...BY_AGENT.slice(0, 1), { ...BY_AGENT[1], takes_key: true }])
        )
        .mockResolvedValueOnce({ id: 'chat-1', agent: 'claude-code', kept_key: 'Gemini API key' });
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));

      const way = await screen.findByRole('button', { name: 'Sign in with Gemini API key' });
      const calls = startChat.mock.calls.length;
      fireEvent.click(way);
      expect(startChat).toHaveBeenCalledTimes(calls);
      const field = screen.getByLabelText('Key');
      expect(field).toHaveAttribute('type', 'password');
      expect(
        screen.getByText('Stored in the machine’s keychain, where there is one.')
      ).toBeInTheDocument();
      const go = screen.getByRole('button', { name: 'Sign in with Gemini API key' });
      expect(go).toBeDisabled();

      fireEvent.change(field, { target: { value: ' a-key ' } });
      fireEvent.click(go);

      expect(await screen.findByRole('button', { name: ZASPER_MODE })).toBeInTheDocument();
      expect(startChat).toHaveBeenLastCalledWith(
        'claude-code',
        expect.anything(),
        'gemini-api-key',
        'a-key'
      );
    });

    it('closes the key field on Cancel, with nothing sent', async () => {
      startChat.mockRejectedValueOnce(refused([{ ...BY_AGENT[1], takes_key: true }]));
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      const way = await screen.findByRole('button', { name: 'Sign in with Gemini API key' });
      const calls = startChat.mock.calls.length;
      fireEvent.click(way);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByLabelText('Key')).not.toBeInTheDocument();
      expect(startChat).toHaveBeenCalledTimes(calls);
    });

    it('goes back to the ways when a sign-in by the agent is given up on', async () => {
      startChat
        .mockRejectedValueOnce(refused(BY_AGENT))
        .mockImplementationOnce(
          (_agent: string, signal: AbortSignal) =>
            new Promise((_resolve, reject) =>
              signal.addEventListener('abort', () => reject(new Error('aborted')))
            )
        );
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      fireEvent.click(
        await screen.findByRole('button', { name: 'Sign in with Log in with Google' })
      );
      await screen.findByRole('status', { name: 'Signing in to Claude Code' });

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(
        await screen.findByRole('heading', { name: 'Sign in to Claude Code' })
      ).toBeInTheDocument();
    });

    it('offers the agent’s ways, runs one in a terminal, and says so when it is still not done', async () => {
      startChat.mockRejectedValueOnce(refused()).mockRejectedValueOnce(refused());
      render(
        <Provider>
          <AgentPanel hidden={false} />
          <Pending />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));

      expect(
        await screen.findByRole('heading', { name: 'Sign in to Claude Code' })
      ).toBeInTheDocument();
      const ways = screen.getByRole('region', { name: 'Ways to sign in' });
      expect(ways).toHaveTextContent('Claude SubscriptionUse Claude subscription');
      expect(ways).toHaveTextContent('Anthropic ConsoleUse Anthropic Console (API usage billing)');

      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude Subscription' }));
      expect(JSON.parse(screen.getByTestId('pending').textContent!)).toEqual({
        'Sign in to Claude Code': ['claude-agent-acp --cli auth login --claudeai\r'],
      });
      expect(
        screen.getByRole('heading', { name: 'Finish signing in in the terminal' })
      ).toBeInTheDocument();
      expect(screen.getByText('claude-agent-acp --cli auth login --claudeai')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(
        await screen.findByText(
          'Claude Code is still not signed in. Finish in the terminal, then try again.'
        )
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('button', { name: ZASPER_MODE })).toBeInTheDocument();
    });

    it('goes back to the ways when the agent asks again in the middle of a chat', async () => {
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      await screen.findByRole('button', { name: ZASPER_MODE });

      FakeSocket.latest.push({ type: 'sign_in', sign_in: WAYS });

      expect(await screen.findByText('Claude Code needs to be signed in.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Sign in to Claude Code' })).toBeInTheDocument();
    });

    it('keeps the message refused once signed out, for the chat that starts once signed in', async () => {
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      await screen.findByRole('button', { name: ZASPER_MODE });
      FakeSocket.latest.push({
        type: 'account',
        account: { signed_in: true, label: 'Claude Pro' },
      });
      FakeSocket.latest.push({ type: 'user', text: 'Make greet take a greeting word.' });
      FakeSocket.latest.push({ type: 'account', account: { signed_in: false } });
      FakeSocket.latest.push({ type: 'sign_in', sign_in: WAYS });

      expect(
        await screen.findByText(
          'Claude Code was signed out. Your last message was not sent: it will be in the field once you are signed in.'
        )
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude Subscription' }));
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      await screen.findByRole('button', { name: ZASPER_MODE });
      expect(screen.getByLabelText('Message to the agent')).toHaveValue(
        'Make greet take a greeting word.'
      );
    });

    it('offers no Sign out while the agent says it is not signed in', async () => {
      startChat.mockResolvedValueOnce({
        id: 'chat-1',
        agent: 'claude-code',
        can_sign_out: true,
        sign_in_ways: WAYS,
      });
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      await screen.findByRole('button', { name: ZASPER_MODE });
      FakeSocket.latest.push({ type: 'account', account: { signed_in: false } });

      fireEvent.click(screen.getByRole('button', { name: 'More settings for Claude Code' }));

      expect(
        screen.queryByRole('menuitem', { name: 'Sign out of Claude Code' })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('menuitem', { name: 'Claude Subscription in a terminal' })
      ).toBeInTheDocument();
    });

    it('says signing out forgets the key Zasper kept', async () => {
      startChat.mockResolvedValueOnce({
        id: 'chat-1',
        agent: 'claude-code',
        can_sign_out: true,
        kept_key: 'Gemini API key',
      });
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      await screen.findByRole('button', { name: ZASPER_MODE });

      fireEvent.click(screen.getByRole('button', { name: 'More settings for Claude Code' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out of Claude Code' }));

      expect(screen.getByRole('dialog', { name: 'Sign out of Claude Code?' })).toHaveTextContent(
        'ends this chat. Zasper forgets the Gemini API key it kept. You can sign in again'
      );
    });

    it('shows who is signed in under More, and signs out once asked', async () => {
      startChat.mockResolvedValueOnce({ id: 'chat-1', agent: 'claude-code', can_sign_out: true });
      signOutChat.mockResolvedValue(WAYS);
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
      await screen.findByRole('button', { name: ZASPER_MODE });
      FakeSocket.latest.push({
        type: 'account',
        account: { signed_in: true, label: 'Claude Pro' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'More settings for Claude Code' }));
      const menu = screen.getByRole('menu', { name: 'More settings for Claude Code' });
      expect(menu).toHaveTextContent('Claude Prosigned in');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out of Claude Code' }));

      const ask = screen.getByRole('dialog', { name: 'Sign out of Claude Code?' });
      expect(ask).toHaveTextContent('everywhere on this computer');
      expect(signOutChat).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

      expect(await screen.findByText('Signed out of Claude Code.')).toBeInTheDocument();
      expect(signOutChat).toHaveBeenCalledWith('chat-1');
      expect(
        screen.getByRole('button', { name: 'Sign in with Claude Subscription' })
      ).toBeInTheDocument();
    });
  });

  it('keeps what was typed until the chat is connected', async () => {
    render(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );
    FakeSocket.autoOpen = false;
    fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
    const box = await screen.findByLabelText('Message to the agent');
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'too early' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(box).toHaveValue('too early');
    expect(FakeSocket.latest.sent).toEqual([]);
  });

  it('opens what a tool printed and the change it made under its row', async () => {
    render(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start Claude Code' }));
    await screen.findByRole('button', { name: ZASPER_MODE });
    const socket = FakeSocket.latest;
    socket.push({
      type: 'update',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Edit prepare.py',
        kind: 'edit',
        status: 'completed',
        content: [
          { type: 'diff', path: '/project/prepare.py', oldText: 'X = 1\n', newText: 'X = 2\n' },
          { type: 'content', content: { type: 'text', text: 'Updated one line' } },
        ],
      },
    });

    const row = await screen.findByRole('button', { name: /Edit prepare.py/ });
    expect(screen.queryByText('Updated one line')).not.toBeInTheDocument();
    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Updated one line')).toBeInTheDocument();
    expect(screen.getByText(/X = 2/)).toHaveClass('agentDiff-line', 'is-added');
  });

  describe('past conversations', () => {
    beforeEach(() => {
      listChats.mockResolvedValue([{ id: 'chat-1', agent: 'claude-code', history: true }]);
      listPastChats.mockImplementation((_chat: string, cursor?: string) =>
        Promise.resolve(
          cursor
            ? { chats: [{ id: 'older', title: 'Fix the loader' }], next: '' }
            : {
                chats: [
                  { id: 'now', title: 'This one', current: true },
                  { id: 'earlier', title: 'Plot the results', updated: '2026-10-11T09:00:00Z' },
                ],
                next: 'page-2',
              }
        )
      );
      openPastChat.mockResolvedValue(undefined);
    });

    it('lists them a page at a time, the one open now not to be picked', async () => {
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Past conversations' }));

      expect(await screen.findByRole('menuitem', { name: /This one/ })).toBeDisabled();
      expect(screen.getByRole('menuitem', { name: /Plot the results/ })).toBeEnabled();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Show more' }));

      expect(await screen.findByRole('menuitem', { name: /Fix the loader/ })).toBeInTheDocument();
      expect(listPastChats).toHaveBeenLastCalledWith('chat-1', 'page-2');
      expect(screen.queryByRole('menuitem', { name: 'Show more' })).not.toBeInTheDocument();
    });

    it('drops over the conversation, which stays, and goes on in the one picked', async () => {
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      const clock = await screen.findByRole('button', { name: 'Past conversations' });
      fireEvent.click(clock);

      expect(clock).toHaveAttribute('aria-expanded', 'true');
      expect(await screen.findByRole('menu', { name: 'Past conversations' })).toBeInTheDocument();
      expect(screen.getByLabelText('Message to the agent')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('menuitem', { name: /Plot the results/ }));

      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
      expect(openPastChat).toHaveBeenCalledWith('chat-1', 'earlier', 'Plot the results');
    });

    it('closes on Escape and on a press outside it', async () => {
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      const clock = await screen.findByRole('button', { name: 'Past conversations' });

      fireEvent.click(clock);
      await screen.findByRole('menu', { name: 'Past conversations' });
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();

      fireEvent.click(clock);
      await screen.findByRole('menu', { name: 'Past conversations' });
      fireEvent.mouseDown(screen.getByLabelText('Message to the agent'));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('is not offered for an agent that cannot open its past conversations', async () => {
      listChats.mockResolvedValue([{ id: 'chat-1', agent: 'claude-code' }]);
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );

      await screen.findByRole('button', { name: 'New chat' });
      expect(screen.queryByRole('button', { name: 'Past conversations' })).not.toBeInTheDocument();
    });
  });

  describe('a turn’s changes', () => {
    async function turnThatChanged() {
      listChats.mockResolvedValue([{ id: 'chat-1', agent: 'claude-code' }]);
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      await screen.findByRole('button', { name: ZASPER_MODE });
      FakeSocket.latest.push({ type: 'user', text: 'tidy it' });
      FakeSocket.latest.push({
        type: 'changes',
        changes: {
          turn: 1,
          files: [
            { path: 'prepare.py', status: 'M' },
            { path: 'old.csv', status: 'D' },
          ],
        },
      });
      FakeSocket.latest.push({ type: 'turn_end', stop_reason: 'end_turn' });
    }

    it('lists the files it changed, and takes the turn back', async () => {
      undoTurn.mockReset().mockResolvedValue(undefined);
      await turnThatChanged();

      expect(screen.getByText('2 files changed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'prepare.py' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Undo this turn' }));

      await waitFor(() => expect(undoTurn).toHaveBeenCalledWith('chat-1', 1, false, undefined));
      FakeSocket.latest.push({ type: 'undone', changes: { turn: 1 } });
      expect(screen.getByText('Undone')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Undo this turn' })).not.toBeInTheDocument();
    });

    it('puts back one file of the turn on its own', async () => {
      undoTurn.mockReset().mockResolvedValue(undefined);
      await turnThatChanged();

      fireEvent.click(screen.getByRole('button', { name: 'Undo the turn’s change to old.csv' }));

      await waitFor(() => expect(undoTurn).toHaveBeenCalledWith('chat-1', 1, false, ['old.csv']));
      FakeSocket.latest.push({
        type: 'undone',
        changes: { turn: 1, files: [{ path: 'old.csv', status: 'D' }] },
      });
      expect(screen.getByText('undone')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Undo this turn' })).toBeInTheDocument();
    });

    it('says which files changed since, and undoes over them only when asked', async () => {
      undoTurn
        .mockReset()
        .mockRejectedValueOnce(
          new ApiError('POST', '/undo', 409, JSON.stringify({ changed: ['prepare.py'] }))
        )
        .mockResolvedValue(undefined);
      await turnThatChanged();

      fireEvent.click(screen.getByRole('button', { name: 'Undo this turn' }));

      expect(await screen.findByText(/prepare\.py changed after this turn/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Undo anyway' }));
      await waitFor(() => expect(undoTurn).toHaveBeenLastCalledWith('chat-1', 1, true, undefined));
    });
  });

  describe('mentions', () => {
    async function connected(extra?: React.ReactNode) {
      listChats.mockResolvedValue([{ id: 'chat-1', agent: 'claude-code' }]);
      render(
        <Provider>
          {extra}
          <AgentPanel hidden={false} />
        </Provider>
      );
      await screen.findByRole('button', { name: ZASPER_MODE });
      return screen.getByLabelText('Message to the agent') as HTMLTextAreaElement;
    }

    function type(field: HTMLTextAreaElement, text: string) {
      fireEvent.change(field, { target: { value: text, selectionStart: text.length } });
    }

    it('finds a file after an @, and sends it with the message', async () => {
      searchFiles.mockResolvedValue([
        { type: 'file', name: 'reader.py', path: 'reader.py', content: null },
        {
          type: 'file',
          name: 'readings.csv',
          path: 'data/readings.csv',
          content: null,
          ignored: true,
        },
      ]);
      const field = await connected();

      type(field, 'clean @rea');
      const ignored = await screen.findByRole('option', { name: /readings\.csv/ });
      // What .gitignore leaves out is offered too: a dataset often is.
      expect(searchFiles).toHaveBeenLastCalledWith('rea', true, true);
      expect(ignored).toHaveClass('is-ignored');
      fireEvent.keyDown(field, { key: 'ArrowDown' });
      fireEvent.keyDown(field, { key: 'ArrowDown' });
      fireEvent.keyDown(field, { key: 'ArrowUp' });
      fireEvent.keyDown(field, { key: 'Enter' });

      expect(field.value).toBe('clean @data/readings.csv ');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Mentioned')).toHaveTextContent('readings.csv');
      fireEvent.keyDown(field, { key: 'Enter' });

      expect(FakeSocket.latest.sent).toContainEqual({
        type: 'prompt',
        text: 'clean @data/readings.csv',
        mentions: [{ kind: 'file', path: 'data/readings.csv', label: 'readings.csv' }],
      });
      expect(screen.queryByLabelText('Mentioned')).not.toBeInTheDocument();
    });

    it('sends a cell added from the notebook with its source', async () => {
      function AddsACell() {
        const add = useAddMention();
        useEffect(() => {
          add(
            cellMention(
              'fit.ipynb',
              {
                id: 'c4',
                cell_type: 'code',
                source: 'model.fit(x)',
                outputs: [],
                metadata: {},
                execution_count: 1,
                reload: false,
              },
              3
            )
          );
        }, [add]);
        return null;
      }
      const field = await connected(<AddsACell />);
      expect(screen.getByLabelText('Mentioned')).toHaveTextContent('fit.ipynb · cell 4');

      type(field, 'why is this slow?');
      fireEvent.keyDown(field, { key: 'Enter' });

      expect(FakeSocket.latest.sent).toContainEqual({
        type: 'prompt',
        text: 'why is this slow?',
        mentions: [
          {
            kind: 'cell',
            path: 'fit.ipynb',
            label: 'fit.ipynb · cell 4',
            cell_id: 'c4',
            text: 'model.fit(x)',
          },
        ],
      });
    });

    it('draws a sent message’s mentions as chips', async () => {
      await connected();
      FakeSocket.latest.push({
        type: 'user',
        text: 'clean @data/readings.csv please',
        mentions: [
          { kind: 'file', path: 'data/readings.csv', label: 'readings.csv' },
          { kind: 'output', path: 'fit.ipynb', label: 'fit.ipynb · output 4', cell_id: 'c4' },
        ],
      });

      const message = screen.getByText(/please/);
      expect(message).toHaveTextContent('fit.ipynb · output 4clean readings.csv please');
      expect(message).not.toHaveTextContent('@data');
    });
  });
});
