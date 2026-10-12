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
  undoTurn: (chatId: string, turn: number, anyway?: boolean) => undoTurn(chatId, turn, anyway),
  searchFiles: (query: string, ignored?: boolean) => searchFiles(query, ignored),
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
    await screen.findByText('Your own agent, your own subscription');

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
    await screen.findByText('Your own agent, your own subscription');
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

      expect(await screen.findByRole('button', { name: /This one/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Plot the results/ })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

      expect(await screen.findByRole('button', { name: /Fix the loader/ })).toBeInTheDocument();
      expect(listPastChats).toHaveBeenLastCalledWith('chat-1', 'page-2');
      expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    });

    it('goes on in the one picked, back in the conversation', async () => {
      render(
        <Provider>
          <AgentPanel hidden={false} />
        </Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Past conversations' }));

      fireEvent.click(await screen.findByRole('button', { name: /Plot the results/ }));

      await screen.findByPlaceholderText('Ask the agent — @ for a file');
      expect(openPastChat).toHaveBeenCalledWith('chat-1', 'earlier');
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
      await screen.findByText('Your own agent, your own subscription');
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
      expect(screen.getByRole('button', { name: /prepare\.py/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Undo this turn' }));

      await waitFor(() => expect(undoTurn).toHaveBeenCalledWith('chat-1', 1, false));
      FakeSocket.latest.push({ type: 'undone', changes: { turn: 1 } });
      expect(screen.getByText('Undone')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Undo this turn' })).not.toBeInTheDocument();
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
      await waitFor(() => expect(undoTurn).toHaveBeenLastCalledWith('chat-1', 1, true));
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
      await screen.findByText('Your own agent, your own subscription');
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
      expect(searchFiles).toHaveBeenLastCalledWith('rea', true);
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
