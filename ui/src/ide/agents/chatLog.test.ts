import { describe, expect, it } from 'vitest';

import { ChatEvent } from '@/api';
import { foldChat, terminalText } from './chatLog';

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
        {
          id: 't1',
          title: 'Read prepare.py',
          kind: 'read',
          status: 'completed',
          locations: [],
          output: '',
          diffs: [],
        },
        {
          id: 't2',
          title: 'Edit',
          kind: 'edit',
          status: 'pending',
          locations: ['/p/a.py'],
          output: '',
          diffs: [],
        },
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

  it('follows the chat’s mode, and marks a question the mode answered', () => {
    const view = foldChat([
      { type: 'mode', text: 'edits' },
      {
        type: 'permission',
        permission: {
          id: 'q1',
          request: { options: [{ optionId: 'y', name: 'Yes', kind: 'allow_once' }] },
        },
      },
      { type: 'answered', permission: { id: 'q1', option_id: 'y', auto: true } },
    ]);

    expect(view.mode).toBe('edits');
    expect(view.items[0]).toMatchObject({ kind: 'permission', answer: 'y', auto: true });
  });

  it('keeps what a tool printed and the changes it made, as its last update has them', () => {
    const view = foldChat([
      {
        type: 'update',
        update: { sessionUpdate: 'tool_call', toolCallId: 't', title: 'pytest', kind: 'execute' },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't',
          status: 'completed',
          content: [
            { type: 'content', content: { type: 'text', text: '```console\n3 passed\n```' } },
            { type: 'diff', path: '/p/a.py', oldText: 'x = 1', newText: 'x = 2' },
          ],
        },
      },
    ]);

    expect(view.items[0]).toMatchObject({
      kind: 'tools',
      calls: [
        { output: '3 passed', diffs: [{ path: '/p/a.py', oldText: 'x = 1', newText: 'x = 2' }] },
      ],
    });
  });

  it('draws the reader’s messages in a past conversation the agent replays, without waiting on it', () => {
    const view = foldChat([
      {
        type: 'update',
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'what is ' },
        },
      },
      {
        type: 'update',
        update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '2 + 2?' } },
      },
      said('4'),
    ]);

    expect(view.items).toEqual([
      { kind: 'user', text: 'what is 2 + 2?' },
      { kind: 'agent', text: '4' },
    ]);
    expect(view.answering).toBe(false);
  });

  describe('a command', () => {
    const runs = (content: unknown[], _meta?: unknown): ChatEvent => ({
      type: 'update',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'c',
        title: 'make',
        kind: 'execute',
        content,
        _meta,
      },
    });

    it('run in Zasper shows what it printed as it came, and how it ended', () => {
      const view = foldChat([
        { type: 'terminal', terminal: { id: 'T', output: 'one\n' } },
        runs([{ type: 'terminal', terminalId: 'T' }]),
        { type: 'terminal', terminal: { id: 'T', output: 'two\n' } },
        { type: 'terminal', terminal: { id: 'T', exited: true, exit_code: 2 } },
      ]);

      expect(view.items[0]).toMatchObject({
        calls: [
          { terminal: { output: 'one\ntwo\n', cut: false, exit: { code: 2, signal: null } } },
        ],
      });
    });

    it('shows the end alone of an output too long to send', () => {
      const view = foldChat([
        runs([{ type: 'terminal', terminalId: 'T' }]),
        { type: 'terminal', terminal: { id: 'T', output: 'start\n' } },
        {
          type: 'terminal',
          terminal: { id: 'T', output: 'the end\n', cut: true, exited: true, exit_code: 0 },
        },
      ]);

      expect(view.items[0]).toMatchObject({
        calls: [{ terminal: { output: 'the end\n', cut: true } }],
      });
    });

    it('run by Claude Code shows the output and exit it sends beside the call, and how long it has run', () => {
      const view = foldChat([
        runs([{ type: 'terminal', terminalId: 'c' }], { terminal_info: { terminal_id: 'c' } }),
        {
          type: 'update',
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c',
            status: 'in_progress',
            _meta: { claudeCode: { toolResponse: { elapsedTimeSeconds: 4 } } },
          },
        },
        {
          type: 'update',
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c',
            _meta: { terminal_output: { terminal_id: 'c', data: 'built\n' } },
          },
        },
        {
          type: 'update',
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'c',
            status: 'completed',
            _meta: { terminal_exit: { terminal_id: 'c', exit_code: 0, signal: null } },
          },
        },
      ]);

      expect(view.items[0]).toMatchObject({
        calls: [
          {
            status: 'completed',
            elapsedSeconds: 4,
            terminal: { output: 'built\n', exit: { code: 0, signal: null } },
          },
        ],
      });
    });
  });

  it('says a command Claude Code leaves pending is running, once nothing is asked of it', () => {
    const start: ChatEvent[] = [
      { type: 'user', text: 'test it' },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'c',
          title: 'pytest',
          kind: 'execute',
          status: 'pending',
          _meta: { terminal_info: { terminal_id: 'c' } },
        },
      },
      {
        type: 'permission',
        permission: { id: 'q', request: { toolCall: { toolCallId: 'c' }, options: [] } },
      },
    ];
    const status = (events: ChatEvent[]) =>
      (foldChat(events).items[1] as { calls: { status: string }[] }).calls[0].status;

    expect(status(start)).toBe('pending');
    const answered: ChatEvent[] = [
      ...start,
      { type: 'answered', permission: { id: 'q', option_id: 'allow' } },
    ];
    expect(status(answered)).toBe('in_progress');
    expect(status([...answered, { type: 'turn_end', stop_reason: 'cancelled' }])).toBe('pending');
  });

  it('reads a command’s output without its colours, and a redrawn line as it was left', () => {
    expect(terminalText('\x1b[32mok\x1b[0m\r\n10%\r50%\r100%\n\x1b]0;title\x07done')).toBe(
      'ok\n100%\ndone'
    );
  });
});
