import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Provider } from '@/testing/Provider';
import AgentPanel from './AgentPanel';

const listAgents = vi.fn();
const listChats = vi.fn();
const startChat = vi.fn();

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  listAgents: () => listAgents(),
  listChats: () => listChats(),
  startChat: (agent: string) => startChat(agent),
  stopChat: () => Promise.resolve(),
}));

vi.mock('@/ide/editor/notebook/MarkdownRenderer', () => ({
  default: ({ source }: { source: string }) => <p>{source}</p>,
}));

/** The chat's socket: what the server sends is pushed by hand, and what the panel sends is kept. */
class FakeSocket {
  static latest: FakeSocket;
  static OPEN = 1;
  readyState = 1;
  sent: Record<string, string>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.latest = this;
    setTimeout(() => this.onopen?.(), 0);
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
});
