import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ChatItem, ChatView } from './chatLog';
import { useChatAnnouncer } from './useChatAnnouncer';

function view(items: ChatItem[], answering: boolean): ChatView {
  return { items, plan: [], answering, exited: false, mode: 'ask' };
}

const asked: ChatItem = { kind: 'user', text: 'What is 2 + 2?', mentions: [] };

describe('useChatAnnouncer', () => {
  it('says the reply once the turn is over, not while it streams', () => {
    const { result, rerender } = renderHook(({ v }) => useChatAnnouncer(v), {
      initialProps: { v: view([asked], true) },
    });
    rerender({ v: view([asked, { kind: 'agent', text: 'It is' }], true) });
    expect(result.current).toBe('');

    rerender({ v: view([asked, { kind: 'agent', text: 'It is 4.' }], false) });
    expect(result.current).toBe('It is 4.');
  });

  it('says a question the agent is waiting on', () => {
    const { result, rerender } = renderHook(({ v }) => useChatAnnouncer(v), {
      initialProps: { v: view([asked], true) },
    });
    const permission: ChatItem = { kind: 'permission', id: 'p', title: 'Run ls', options: [] };
    rerender({ v: view([asked, permission], true) });
    expect(result.current).toBe('The agent asks: Run ls');
  });

  it('says nothing of a conversation it opened onto', () => {
    const { result } = renderHook(() =>
      useChatAnnouncer(view([asked, { kind: 'agent', text: 'Hi' }], false))
    );
    expect(result.current).toBe('');
  });
});
