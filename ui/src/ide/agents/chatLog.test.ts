import { describe, expect, it } from 'vitest';

import { ChatEvent } from '@/api';
import { foldChat } from './chatLog';

const said = (text: string): ChatEvent => ({
  type: 'update',
  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
});

describe('foldChat', () => {
  it('joins the chunks the agent streams into one message', () => {
    const view = foldChat([{ type: 'user', text: 'hi' }, said('Hello'), said(' there')]);

    expect(view.items).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'agent', text: 'Hello there' },
    ]);
    expect(view.answering).toBe(true);
  });

  it('keeps one row per tool call, changed by its updates', () => {
    const view = foldChat([
      { type: 'user', text: 'fix it' },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 't1',
          title: 'Read prepare.py',
          kind: 'read',
          status: 'pending',
        },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 't2',
          title: 'Edit',
          kind: 'edit',
          locations: [{ path: '/p/a.py' }],
        },
      },
      {
        type: 'update',
        update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' },
      },
    ]);

    expect(view.items[1]).toEqual({
      kind: 'tools',
      calls: [
        { id: 't1', title: 'Read prepare.py', kind: 'read', status: 'completed', locations: [] },
        { id: 't2', title: 'Edit', kind: 'edit', status: 'pending', locations: ['/p/a.py'] },
      ],
    });
  });

  it('shows the latest plan', () => {
    const entry = (content: string, status: string) => ({ content, status, priority: 'medium' });
    const view = foldChat([
      {
        type: 'update',
        update: { sessionUpdate: 'plan', entries: [entry('Load', 'in_progress')] },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'plan',
          entries: [entry('Load', 'completed'), entry('Fit', 'pending')],
        },
      },
    ]);

    expect(view.plan).toEqual([
      { content: 'Load', status: 'completed' },
      { content: 'Fit', status: 'pending' },
    ]);
  });

  it('puts the answer to a question beside it, and a withdrawn one as null', () => {
    const options = [{ optionId: 'allow', name: 'Yes', kind: 'allow_once' }];
    const ask = (id: string): ChatEvent => ({
      type: 'permission',
      permission: { id, request: { toolCall: { title: 'Edit a.py' }, options } },
    });

    const view = foldChat([
      ask('q1'),
      { type: 'answered', permission: { id: 'q1', option_id: 'allow' } },
      ask('q2'),
      { type: 'answered', permission: { id: 'q2' } },
      ask('q3'),
    ]);

    expect(view.items.map((item) => (item.kind === 'permission' ? item.answer : 'other'))).toEqual([
      'allow',
      null,
      undefined,
    ]);
  });

  it('ends the turn, and says why when it did not end normally', () => {
    const view = foldChat([
      { type: 'user', text: 'go' },
      { type: 'turn_end', stop_reason: 'cancelled' },
    ]);

    expect(view.answering).toBe(false);
    expect(view.items[1]).toEqual({ kind: 'note', text: 'Stopped.', failed: false });
  });

  it('says the agent has stopped when its process ends', () => {
    const view = foldChat([{ type: 'exited', text: 'the agent exited with code 1' }]);

    expect(view.exited).toBe(true);
    expect(view.items[0]).toEqual({
      kind: 'note',
      text: 'the agent exited with code 1',
      failed: true,
    });
  });

  it('keeps thoughts apart from the answer', () => {
    const view = foldChat([
      {
        type: 'update',
        update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } },
      },
      said('Done'),
    ]);

    expect(view.items).toEqual([
      { kind: 'thought', text: 'hmm' },
      { kind: 'agent', text: 'Done' },
    ]);
  });
});
