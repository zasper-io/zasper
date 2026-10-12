import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api';
import { Provider } from '@/testing/Provider';
import AgentPanel from './AgentPanel';

const listAgents = vi.fn();
const listChats = vi.fn();
const startChat = vi.fn();
const listPastChats = vi.fn();
const openPastChat = vi.fn();
const undoTurn = vi.fn();

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  listAgents: () => listAgents(),
  listChats: () => listChats(),
  startChat: (agent: string) => startChat(agent),
  stopChat: () => Promise.resolve(),
  listPastChats: (chatId: string, cursor?: string) => listPastChats(chatId, cursor),
  openPastChat: (chatId: string, id: string) => openPastChat(chatId, id),
  undoTurn: (chatId: string, turn: number, anyway?: boolean) => undoTurn(chatId, turn, anyway),
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
      { id: 'claude-code', name: 'Claude Code', installed: true, hint: 'npm i' },
      { id: 'codex', name: 'Codex', installed: false, hint: 'install codex-acp' },
    ]);
    listChats.mockResolvedValue([]);
    startChat.mockResolvedValue({ id: 'chat-1', agent: 'claude-code' });
  });

  it('offers the agents installed, and how to install the others', async () => {
    render(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );

    const claude = await screen.findByRole('button', { name: /Claude Code/ });
    expect(claude).toBeEnabled();
    expect(screen.getByRole('button', { name: /Codex/ })).toBeDisabled();
    expect(screen.getByText('install codex-acp')).toBeInTheDocument();
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
    await screen.findByRole('button', { name: /Claude Code/ });
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
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
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
    expect(socket.sent).toContainEqual({ type: 'prompt', text: 'thanks' });
  });

  it('keeps what was typed until the chat is connected', async () => {
    render(
      <Provider>
        <AgentPanel hidden={false} />
      </Provider>
    );
    FakeSocket.autoOpen = false;
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
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
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
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

      await screen.findByPlaceholderText('Ask the agent');
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
});
