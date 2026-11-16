import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api';
import { Provider } from '@/testing/Provider';
import AgentPanel from './AgentPanel';
import { cellMention, useAddMention } from './mentions';

const listAgents = vi.fn();
const listChats = vi.fn();
const startChat = vi.fn();
const startCommand = vi.fn();
const listPastChats = vi.fn();
const openPastChat = vi.fn();
const undoTurn = vi.fn();
const searchFiles = vi.fn();

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  listAgents: () => listAgents(),
  listChats: () => listChats(),
  startChat: (agent: string, signal?: AbortSignal) => startChat(agent, signal),
  startCommand: (command: string) => startCommand(command),
  stopChat: () => Promise.resolve(),
  listPastChats: (chatId: string, cursor?: string) => listPastChats(chatId, cursor),
  openPastChat: (chatId: string, id: string) => openPastChat(chatId, id),
  undoTurn: (chatId: string, turn: number, anyway?: boolean, paths?: string[]) =>
    undoTurn(chatId, turn, anyway, paths),
  searchFiles: (query: string, ignored?: boolean, inPaths?: boolean) =>
    searchFiles(query, ignored, inPaths),
}));

vi.mock('@/ide/editor/notebook/MarkdownRenderer', () => ({
  default: ({ source }: { source: string }) => <p>{source}</p>,
}));

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

    it('draws a chip for the model, the effort and the mode, in that order, and the rest under More', async () => {
      const socket = await connect();
      socket.push(settings);

      const chips = screen
        .getAllByRole('button', { name: /^(Model|Effort|Mode):/ })
        .map((chip) => chip.getAttribute('aria-label'));
      expect(chips).toEqual(['Model: Large', 'Effort: High', 'Mode: Plan']);
      expect(screen.queryByRole('button', { name: ZASPER_MODE })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'More settings for claude-code' }));
      const more = screen.getByRole('menu', { name: 'More settings for claude-code' });
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
        screen.queryByRole('button', { name: 'More settings for claude-code' })
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
      expect(openPastChat).toHaveBeenCalledWith('chat-1', 'earlier');
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
