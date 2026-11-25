import { describe, expect, it } from 'vitest';

import { ChatEvent } from '@/api';
import { foldChat, terminalText, ToolCall } from './chatLog';

const said = (text: string): ChatEvent => ({
  type: 'update',
  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
});

describe('foldChat', () => {
  it('joins the chunks the agent streams into one message', () => {
    const view = foldChat([{ type: 'user', text: 'hi' }, said('Hello'), said(' there')]);

    expect(view.items).toEqual([
      { kind: 'user', text: 'hi', mentions: [] },
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
          calls: [],
        },
        {
          id: 't2',
          title: 'Edit a.py',
          kind: 'edit',
          status: 'pending',
          locations: ['/p/a.py'],
          output: '',
          diffs: [],
          calls: [],
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

  it('names a call by its tool and its file, when the agent names it by the tool alone', () => {
    const view = foldChat([
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'r',
          title: 'read',
          kind: 'read',
          status: 'pending',
          locations: [],
        },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'r',
          title: 'read',
          status: 'in_progress',
          locations: [{ path: '/p/src/hello.py' }],
        },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'g',
          title: 'grep',
          kind: 'search',
          status: 'completed',
          locations: [{ path: '/p/a.py' }, { path: '/p/b.py' }],
        },
      },
    ]);

    const tools = view.items[0];
    expect(tools.kind === 'tools' && tools.calls.map((call) => call.title)).toEqual([
      'read hello.py',
      'grep',
    ]);

    // Its permission request names the call by the file alone, which says it already.
    const asked = foldChat([
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'e',
          title: 'edit',
          kind: 'edit',
          locations: [{ path: '/p/hello.py' }],
        },
      },
      {
        type: 'permission',
        permission: {
          id: 'q',
          request: { toolCall: { toolCallId: 'e', title: 'hello.py' }, options: [] },
        },
      },
    ]);
    const edit = asked.items[0];
    expect(edit.kind === 'tools' && edit.calls[0].title).toBe('hello.py');
  });

  it('draws the agent’s form as questions under the call that asks, and its reply beside it', () => {
    const fields = [
      {
        name: 'q1',
        schema: { type: 'string', title: 'Which?', oneOf: [{ const: '1', title: 'a' }] },
      },
    ];
    const view = foldChat([
      {
        type: 'question',
        question: { id: 'f1', tool_call_id: 'ask-1', message: 'The agent has a question.', fields },
      },
      { type: 'question', question: { id: 'f2', fields } },
      { type: 'replied', question: { id: 'f1', action: 'accept', content: { q1: '1' } } },
    ]);

    const [first, second] = view.items;
    expect(first).toMatchObject({
      kind: 'question',
      id: 'f1',
      message: 'The agent has a question.',
      reply: { action: 'accept', content: { q1: '1' } },
    });
    expect(first.kind === 'question' && first.inputs.map((input) => input.label)).toEqual([
      'Which?',
    ]);
    expect(second).toMatchObject({ kind: 'question', id: 'f2' });
    expect(second.kind === 'question' && second.reply).toBeUndefined();
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
      { kind: 'user', text: 'what is 2 + 2?', mentions: [] },
      { kind: 'agent', text: '4' },
    ]);
    expect(view.answering).toBe(false);
  });

  it('marks the files of a turn put back one at a time, and the turn once all are', () => {
    const changed: ChatEvent = {
      type: 'changes',
      changes: {
        turn: 1,
        files: [
          { path: 'a.py', status: 'M' },
          { path: 'b.py', status: 'A' },
        ],
      },
    };
    const one: ChatEvent = {
      type: 'undone',
      changes: { turn: 1, files: [{ path: 'a.py', status: 'M' }] },
    };
    const other: ChatEvent = {
      type: 'undone',
      changes: { turn: 1, files: [{ path: 'b.py', status: 'A' }] },
    };

    expect(foldChat([changed, one]).items[0]).toMatchObject({
      undone: false,
      files: [
        { path: 'a.py', undone: true },
        { path: 'b.py', undone: false },
      ],
    });
    expect(foldChat([changed, one, other]).items[0]).toMatchObject({ undone: true });
  });

  it('lists the files a turn changed, and marks them once taken back', () => {
    const changed: ChatEvent = {
      type: 'changes',
      changes: { turn: 1, files: [{ path: 'a.py', status: 'M' }] },
    };
    expect(foldChat([changed]).items).toEqual([
      {
        kind: 'changes',
        turn: 1,
        files: [{ path: 'a.py', status: 'M', undone: false }],
        undone: false,
      },
    ]);
    expect(foldChat([changed, { type: 'undone', changes: { turn: 1 } }]).items[0]).toMatchObject({
      undone: true,
    });
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

  it('takes the change an edit asks to make from the request, as Antigravity sends it only there', () => {
    const change = {
      type: 'diff',
      path: '/p/hello.py',
      oldText: 'print(1)',
      newText: 'print(1)\nprint(2)',
    };
    const view = foldChat([
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'c',
          title: 'File hello.py',
          kind: 'edit',
          status: 'pending',
        },
      },
      {
        type: 'permission',
        permission: {
          id: 'q',
          request: { toolCall: { toolCallId: 'c', content: [change] }, options: [] },
        },
      },
    ]);

    const diff = { path: '/p/hello.py', oldText: 'print(1)', newText: 'print(1)\nprint(2)' };
    expect((view.items[0] as { calls: { diffs: unknown[] }[] }).calls[0].diffs).toEqual([diff]);
    expect(view.items[1]).toMatchObject({
      kind: 'permission',
      title: 'File hello.py',
      diffs: [diff],
    });
  });

  it('keeps a document written for the reader, as last written, and names its row by the file', () => {
    const plan = '/home/u/.gemini/brain/s/plan.md';
    const write = (id: string, content: string, userFacing: boolean): ChatEvent => ({
      type: 'update',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: id,
        title: `File ../../../${plan.slice(1)}`,
        kind: 'edit',
        locations: [{ path: plan }],
        rawInput: { Path: plan, Content: content, ArtifactMetadata: { UserFacing: userFacing } },
      },
    });

    const view = foldChat([
      write('a', '# One', true),
      write('b', '# Two', true),
      write('c', '# Not for the reader', false),
    ]);

    const calls = (view.items[0] as { calls: { title: string; doc?: unknown }[] }).calls;
    expect(calls.map((call) => call.title)).toEqual([
      'File plan.md',
      'File plan.md',
      'File plan.md',
    ]);
    expect(calls[2].doc).toBeUndefined();
    expect(view.docs).toEqual([{ path: plan, name: 'plan.md', text: '# Two' }]);
  });

  it('says a turn ended with nothing from the agent, and says nothing when something came', () => {
    const notes = (events: ChatEvent[]) =>
      foldChat(events)
        .items.filter((item) => item.kind === 'note')
        .map((item) => (item as { text: string }).text);
    const end: ChatEvent = { type: 'turn_end', stop_reason: 'end_turn' };

    expect(notes([{ type: 'user', text: '/compact' }, end])).toEqual(['Done, with no reply.']);
    expect(
      notes([
        { type: 'user', text: 'hi' },
        {
          type: 'update',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello' },
          },
        },
        end,
      ])
    ).toEqual([]);
  });

  it('keeps the agent’s settings as it last sent them, each value with its group', () => {
    const view = foldChat([
      {
        type: 'settings',
        settings: [{ id: 'model', name: 'Model', type: 'select', currentValue: 'a', options: [] }],
      },
      {
        type: 'settings',
        settings: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'b',
            options: [
              { group: 'fast', name: 'Fast', options: [{ value: 'b', name: 'B' }] },
              { group: 'slow', name: 'Slow', options: [{ value: 'c', name: 'C' }] },
            ],
          },
          { id: 'ultra', name: 'Ultra', description: 'More', type: 'boolean', currentValue: true },
        ],
      },
    ]);

    expect(view.settings).toEqual([
      {
        kind: 'choice',
        id: 'model',
        name: 'Model',
        category: 'model',
        value: 'b',
        values: [
          { value: 'b', name: 'B', group: 'Fast' },
          { value: 'c', name: 'C', group: 'Slow' },
        ],
      },
      {
        kind: 'switch',
        id: 'ultra',
        name: 'Ultra',
        description: 'More',
        category: '',
        value: true,
      },
    ]);
  });

  it('keeps the chat’s title and how full its context is, as the agent last said', () => {
    const update = (update: object): ChatEvent => ({ type: 'update', update });
    const view = foldChat([
      update({ sessionUpdate: 'session_info_update', title: 'Sensor drift' }),
      update({ sessionUpdate: 'session_info_update', updatedAt: '2026-11-16T09:00:00Z' }),
      update({ sessionUpdate: 'usage_update', used: 1000, size: 200000 }),
      update({
        sessionUpdate: 'usage_update',
        used: 76000,
        size: 200000,
        cost: { amount: 1.92, currency: 'USD' },
      }),
    ]);

    expect(view.title).toBe('Sensor drift');
    expect(view.usage).toEqual({
      used: 76000,
      size: 200000,
      cost: { amount: 1.92, currency: 'USD' },
    });
    expect(
      foldChat([
        update({ sessionUpdate: 'session_info_update', title: 'A' }),
        update({ sessionUpdate: 'session_info_update', title: null }),
      ]).title
    ).toBeUndefined();
  });

  it('heads a reopened conversation with its listed title until the agent sends one', () => {
    const named = (title: string): ChatEvent => ({
      type: 'update',
      update: { sessionUpdate: 'session_info_update', title },
    });

    expect(foldChat([{ type: 'title', text: 'Plot the results' }]).title).toBe('Plot the results');
    expect(
      foldChat([{ type: 'title', text: 'Plot the results' }, named('Plot the drift')]).title
    ).toBe('Plot the drift');
    expect(foldChat([named('Plot the drift'), { type: 'title', text: 'Listed' }]).title).toBe(
      'Plot the drift'
    );
  });

  it('keeps the agent’s commands as it last listed them, without their slashes', () => {
    const listed = (availableCommands: object[]): ChatEvent => ({
      type: 'update',
      update: { sessionUpdate: 'available_commands_update', availableCommands },
    });
    const view = foldChat([
      listed([{ name: 'old', description: 'Gone' }]),
      listed([
        { name: 'compact', description: 'Summarise the conversation so far' },
        { name: '/review', description: 'Review a pull request', input: { hint: 'PR number' } },
        { description: 'no name' },
      ]),
    ]);

    expect(view.commands).toEqual([
      { name: 'compact', description: 'Summarise the conversation so far' },
      { name: 'review', description: 'Review a pull request', hint: 'PR number' },
    ]);
  });

  describe('what the agent says about the session', () => {
    const update = (update: object): ChatEvent => ({ type: 'update', update });
    const usage = (used: number) => update({ sessionUpdate: 'usage_update', used, size: 200000 });

    it('keeps a notice, its severity one it knows', () => {
      const view = foldChat([
        update({
          sessionUpdate: 'notice',
          severity: 'warning',
          title: 'Auto mode is not available',
          description: 'The chat is in Manual.',
        }),
        update({ sessionUpdate: 'notice', severity: 'shrug', title: 'Plain' }),
        update({ sessionUpdate: 'notice', severity: 'info' }),
      ]);

      expect(view.items).toEqual([
        {
          kind: 'notice',
          severity: 'warning',
          title: 'Auto mode is not available',
          description: 'The chat is in Manual.',
        },
        { kind: 'notice', severity: 'info', title: 'Plain' },
      ]);
    });

    it('folds a compaction into one item: its summary as streamed, then as sent, and the tokens either side', () => {
      const view = foldChat([
        usage(182000),
        update({ sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'in_progress' }),
        update({
          sessionUpdate: 'compaction_summary_chunk',
          compactionId: 'c1',
          content: { type: 'text', text: 'Fitted ' },
        }),
        update({
          sessionUpdate: 'compaction_summary_chunk',
          compactionId: 'c1',
          content: { type: 'text', text: 'a drift' },
        }),
        update({
          sessionUpdate: 'compaction_update',
          compactionId: 'c1',
          status: 'completed',
          summary: [{ type: 'text', text: 'Fitted a drift per sensor.' }],
        }),
        usage(18000),
        usage(20000),
      ]);

      const compactions = view.items.filter((item) => item.kind === 'compaction');
      expect(compactions).toEqual([
        {
          kind: 'compaction',
          id: 'c1',
          status: 'completed',
          summary: 'Fitted a drift per sensor.',
          before: 182000,
          after: 18000,
        },
      ]);
    });

    it('says once a crossing that the context is nearly full, offering /compact when the agent has it', () => {
      const commands = update({
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'compact', description: 'Summarise' }],
      });
      const notices = (events: ChatEvent[]) =>
        foldChat(events).items.filter((item) => item.kind === 'notice');

      expect(notices([usage(182000), usage(184000)])).toEqual([
        { kind: 'notice', severity: 'warning', title: 'The context is 91% full.' },
      ]);
      expect(notices([commands, usage(182000), usage(18000), usage(190000)])).toEqual([
        {
          kind: 'notice',
          severity: 'warning',
          title: 'The context is 91% full.',
          description: '/compact summarises the conversation so far.',
        },
        {
          kind: 'notice',
          severity: 'warning',
          title: 'The context is 95% full.',
          description: '/compact summarises the conversation so far.',
        },
      ]);
      expect(notices([usage(100000)])).toEqual([]);
    });
  });

  it('puts what a subagent does under the call that started it, and keeps its words out of the reply', () => {
    const under = (parent: string) => ({ _meta: { claudeCode: { parentToolUseId: parent } } });
    const view = foldChat([
      { type: 'user', text: 'why does sensor 4 drift?' },
      {
        type: 'update',
        update: { sessionUpdate: 'tool_call', toolCallId: 'task', title: 'Explore', kind: 'think' },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'g',
          title: 'grep calibrat',
          kind: 'search',
          ...under('task'),
        },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'looking' },
          ...under('task'),
        },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'g',
          status: 'completed',
          ...under('task'),
        },
      },
      said('It is the calibration.'),
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'lost',
          title: 'read',
          kind: 'read',
          ...under('unseen'),
        },
      },
    ]);

    const tools = view.items.filter((item) => item.kind === 'tools');
    expect(tools).toHaveLength(2);
    const task = (tools[0] as { calls: ToolCall[] }).calls[0];
    expect(task.calls.map((call) => [call.id, call.status])).toEqual([['g', 'completed']]);
    expect(view.items.filter((item) => item.kind === 'agent')).toEqual([
      { kind: 'agent', text: 'It is the calibration.' },
    ]);
    // Under a call never seen, a call stands on its own rather than being lost.
    expect((tools[1] as { calls: ToolCall[] }).calls[0].id).toBe('lost');
  });

  describe('a Claude Code subagent that hands its report back', () => {
    const handback = {
      _meta: { claudeCode: { parentToolUseId: 'task', toolName: 'SubagentHandback' } },
    };
    const report = 'Readings are calibrated in calibrate.py.';
    const started = {
      type: 'update',
      update: { sessionUpdate: 'tool_call', toolCallId: 'task', title: 'Explore', kind: 'think' },
    } as const;
    const handingBack = (status: string) => [
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'h',
          title: 'SubagentHandback',
          status: 'pending',
          rawInput: {},
          ...handback,
        },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'h',
          status,
          rawInput: { message: report },
          ...handback,
        },
      },
    ];
    const delivered = {
      type: 'update',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'task',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: 'Delivered by its SubagentHandback call.' },
          },
        ],
      },
    } as const;

    it('shows the report as the output of the call that started it, the handback no row', () => {
      const view = foldChat([started, ...handingBack('completed'), delivered] as ChatEvent[]);

      const task = (view.items[0] as { calls: ToolCall[] }).calls[0];
      expect(task.output).toBe(report);
      expect(task.calls).toEqual([]);
      expect(task.status).toBe('completed');
    });

    it('says the report is not replayed in a conversation reopened, rather than the note to itself', () => {
      const view = foldChat([started, delivered] as ChatEvent[]);

      const task = (view.items[0] as { calls: ToolCall[] }).calls[0];
      expect(task.output).toBe(
        'Its report went to Claude Code, which does not send it again in a conversation reopened.'
      );
    });

    it('keeps a handback that failed, as a row that says so', () => {
      const view = foldChat([started, ...handingBack('failed')] as ChatEvent[]);

      const task = (view.items[0] as { calls: ToolCall[] }).calls[0];
      expect(task.calls.map((call) => [call.title, call.status])).toEqual([
        ['Hand back the report', 'failed'],
      ]);
    });
  });

  it('marks a command the agent left running while it went on', () => {
    const view = foldChat([
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'b',
          title: 'python load_raw.py --all',
          kind: 'execute',
          rawInput: { command: 'python load_raw.py --all', run_in_background: true },
        },
      },
      {
        type: 'update',
        update: { sessionUpdate: 'tool_call_update', toolCallId: 'b', status: 'completed' },
      },
    ]);

    const call = (view.items[0] as { calls: ToolCall[] }).calls[0];
    expect(call.background).toBe(true);
    expect(call.status).toBe('completed');
  });

  it('keeps who is signed in, and that the agent will not go on until someone signs in', () => {
    const ways = [
      { id: 'login', name: 'Fake Account', kind: 'terminal' as const, command: 'fake login' },
    ];
    const view = foldChat([
      { type: 'account', account: { signed_in: true, label: 'Fake Pro' } },
      { type: 'user', text: 'hello' },
      { type: 'account', account: { signed_in: false } },
      { type: 'sign_in', sign_in: ways },
    ]);

    expect(view.account).toEqual({ signed_in: false });
    expect(view.signIn).toEqual(ways);
    expect(view.refused).toBe('hello');
    expect(view.wasSignedIn).toBe(true);
    expect(view.answering).toBe(false);
    expect(foldChat([{ type: 'user', text: 'hi' }]).signIn).toBeUndefined();
    expect(foldChat([{ type: 'sign_in', sign_in: ways }])).toMatchObject({ wasSignedIn: false });
  });

  it('reads a command’s output without its colours, and a redrawn line as it was left', () => {
    expect(terminalText('\x1b[32mok\x1b[0m\r\n10%\r50%\r100%\n\x1b]0;title\x07done')).toBe(
      'ok\n100%\ndone'
    );
  });

  describe('an OpenCode subagent, which works on after its turn', () => {
    const child = 'ses_child';
    const task = 'Find greet calls';
    const marked = { _meta: { 'opencode/child-session': { id: child, depth: 1, title: task } } };
    const input = { agent: 'explore', description: task, prompt: 'Find every call to greet.' };
    const sentOff: ChatEvent[] = [
      { type: 'user', text: 'find the calls to greet' },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'sub',
          title: 'subagent',
          kind: 'think',
          rawInput: {},
        },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'sub',
          title: 'subagent',
          status: 'in_progress',
          rawInput: input,
        },
      },
      { type: 'subagent', subagent: { id: child, title: task, status: 'created' } },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'sub',
          status: 'completed',
          content: [
            {
              type: 'content',
              content: { type: 'text', text: 'The subagent is working in the background.' },
            },
          ],
          rawOutput: { metadata: { sessionID: child, status: 'running' } },
        },
      },
      said('I have sent an explore subagent.'),
      { type: 'turn_end', stop_reason: 'end_turn' },
      { type: 'subagent', subagent: { id: child, title: task, status: 'running' } },
      {
        type: 'update',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Let me search.' },
          ...marked,
        },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: `${child}:grep`,
          title: `${task}: grep`,
          kind: 'search',
          status: 'pending',
          ...marked,
        },
      },
      {
        type: 'update',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: `${child}:grep`,
          title: `${task}: grep`,
          status: 'completed',
          rawInput: { pattern: 'greet\\(' },
          locations: [{ path: '/project' }],
          ...marked,
        },
      },
    ];
    const reportedBack: ChatEvent[] = [
      {
        type: 'update',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'One call: main.py line 3.' },
          ...marked,
        },
      },
      { type: 'subagent', subagent: { id: child, title: task, status: 'completed' } },
      said('It found one call.'),
    ];
    const callOf = (events: ChatEvent[]) =>
      (foldChat(events).items.find((item) => item.kind === 'tools') as { calls: ToolCall[] })
        .calls[0];

    it('names the row by the subagent and its task, its calls under it by what they did', () => {
      const call = callOf(sentOff);

      expect(call.title).toBe('Explore · Find greet calls');
      expect(call.subagent).toMatchObject({ session: child, status: 'running' });
      expect(call.calls.map((each) => each.title)).toEqual(['grep greet\\(']);
      // Its words before its last call are working notes, and the agent's note to itself is not shown.
      expect(call.output).toBe('Let me search.');
    });

    it('keeps its words out of the conversation', () => {
      const texts = foldChat(sentOff)
        .items.filter((item) => item.kind === 'agent')
        .map((item) => (item as { text: string }).text);

      expect(texts).toEqual(['I have sent an explore subagent.']);
    });

    it('says it reported back, and what the agent says then is a message of its own', () => {
      const view = foldChat([...sentOff, ...reportedBack]);

      expect(callOf([...sentOff, ...reportedBack]).output).toBe('One call: main.py line 3.');
      expect(view.items.slice(-2)).toEqual([
        { kind: 'note', text: 'Explore reported back', failed: false },
        { kind: 'agent', text: 'It found one call.' },
      ]);
    });

    it('says why a subagent failed', () => {
      const view = foldChat([
        ...sentOff,
        {
          type: 'subagent',
          subagent: { id: child, title: task, status: 'failed', error: 'no model' },
        },
      ]);

      expect(view.items[view.items.length - 1]).toEqual({
        kind: 'note',
        text: 'Explore failed: no model',
        failed: true,
      });
    });

    it('notes nothing for a subagent done while its turn is still going', () => {
      const view = foldChat([sentOff[0], ...sentOff.slice(1, 5), ...reportedBack]);

      expect(view.items.some((item) => item.kind === 'note')).toBe(false);
    });
  });

  it('never runs what the agent says after a turn onto what it said in it', () => {
    const view = foldChat([
      { type: 'user', text: 'go' },
      said('Sent it off.'),
      { type: 'turn_end', stop_reason: 'end_turn' },
      said('It came back.'),
    ]);

    expect(view.items.slice(1)).toEqual([
      { kind: 'agent', text: 'Sent it off.' },
      { kind: 'agent', text: 'It came back.' },
    ]);
  });
});
