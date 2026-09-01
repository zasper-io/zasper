import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookEditor from './NotebookEditor';
import { IfileTab } from '@/store/TabState';

const notebookContent = {
  cells: [
    {
      cell_type: 'code',
      id: 'server-cell-id',
      execution_count: 0,
      source: 'print("hi")',
      outputs: [],
      metadata: {},
      reload: false,
    },
  ],
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
};

const session = {
  id: 'session-1',
  path: 'notebook.ipynb',
  name: 'notebook.ipynb',
  type: 'notebook',
  kernel: { id: 'kernel-1', name: 'python3' },
};

const getNotebook = vi.fn();
const createSession = vi.fn();

vi.mock('@/api', () => ({
  getNotebook: (path: string) => getNotebook(path),
  createSession: (path: string, name: string, type: string, kernelspec: string) =>
    createSession(path, name, type, kernelspec),
  deleteSession: vi.fn(),
  interruptKernel: vi.fn(),
  saveNotebook: vi.fn(),
  logApiError: () => () => {},
}));

// Cell ids are generated on load and used as the kernel request msg_id, so they
// are made predictable here.
const { nextId, resetIds } = vi.hoisted(() => {
  let counter = 0;
  return {
    nextId: () => `generated-cell-${++counter}`,
    resetIds: () => {
      counter = 0;
    },
  };
});

vi.mock('uuid', () => ({ v4: nextId }));

const generatedCellId = 'generated-cell-1';

interface IFakeSocket {
  url: string;
  sent: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  receive: (message: any) => void;
}

/** Collects the fake sockets the editor opens so tests can push kernel messages. */
const { sockets, FakeSocket } = vi.hoisted(() => {
  const sockets: IFakeSocket[] = [];

  class FakeSocket {
    readyState = 1; // WebSocket.OPEN
    onopen: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    onclose: (() => void) | null = null;
    sent: string[] = [];

    constructor(readonly url: string) {
      sockets.push(this);
      setTimeout(() => this.onopen?.(), 0);
    }

    send(message: string) {
      this.sent.push(message);
    }

    close() {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    receive(message: any) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }

  return { sockets, FakeSocket };
});

vi.mock('websocket', () => ({ w3cwebsocket: FakeSocket }));

// CodeMirror cannot mount under jsdom (its CJS build loads a second copy of
// @codemirror/state, breaking instanceof checks), and the editor surface is not
// what these tests exercise, so cells render a plain textarea instead.
vi.mock('@uiw/react-codemirror', async () => {
  const react = await import('react');
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: (props: any) =>
      react.createElement('textarea', { value: props.value, readOnly: true }),
    Prec: { highest: (extension: unknown) => extension },
  };
});

const tab: IfileTab = {
  type: 'notebook',
  path: 'notebook.ipynb',
  name: 'notebook.ipynb',
  active: true,
  extension: 'ipynb',
  load_required: true,
  kernelspec: 'python3',
};

function kernelMessage(msgType: string, cellId: string, content: unknown) {
  return {
    header: { msg_type: msgType },
    parent_header: { msg_id: cellId },
    content,
  };
}

/** The run button of the focused cell, which CellButtons renders first. */
function runButton(container: HTMLElement): HTMLElement {
  return container.querySelector('.cellOptions button') as HTMLElement;
}

describe('NotebookEditor', () => {
  beforeEach(() => {
    sockets.length = 0;
    resetIds();
    getNotebook.mockReset();
    createSession.mockReset();
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: tab.type,
      path: tab.path,
      content: structuredClone(notebookContent),
    });
    createSession.mockResolvedValue(session);
  });

  it('loads the notebook, starts a session and connects the kernel socket', async () => {
    render(<NotebookEditor data={tab} />);

    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(getNotebook).toHaveBeenCalledWith('notebook.ipynb');
    expect(createSession).toHaveBeenCalledWith(
      'notebook.ipynb',
      'notebook.ipynb',
      'notebook',
      'python3'
    );
    expect(sockets[0].url).toContain('/ws/kernels/kernel-1/channels?session_id=session-1');
    expect(await screen.findByText('[0]:')).toBeInTheDocument();
  });

  it('sends an execute request for the cell that was run', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(runButton(container));

    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const request = JSON.parse(sockets[0].sent[0]);
    expect(request.header.msg_type).toBe('execute_request');
    expect(request.header.msg_id).toBe(generatedCellId);
    expect(request.header.session).toBe('session-1');
    expect(request.content.code).toBe('print("hi")');
    // The cell waits on the kernel: no execution count, spinner instead.
    expect(container.querySelector('.spinner')).toBeInTheDocument();
  });

  it('runs the focused cell from the toolbar', async () => {
    render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(screen.getByTitle('Run Cell'));

    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const request = JSON.parse(sockets[0].sent[0]);
    expect(request.header.msg_type).toBe('execute_request');
    expect(request.header.msg_id).toBe(generatedCellId);
    expect(request.content.code).toBe('print("hi")');
  });

  it('renders kernel output for the cell that requested it', async () => {
    render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    sockets[0].receive(kernelMessage('execute_input', generatedCellId, { execution_count: 3 }));
    expect(await screen.findByText('[3]:')).toBeInTheDocument();

    sockets[0].receive(
      kernelMessage('stream', generatedCellId, { name: 'stdout', text: 'hello from kernel' })
    );
    expect(await screen.findByText('hello from kernel')).toBeInTheDocument();
  });

  it('ignores output addressed to a cell that is no longer loaded', async () => {
    render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    // 'server-cell-id' is the id the notebook arrived with, before it was replaced.
    sockets[0].receive(kernelMessage('execute_input', 'server-cell-id', { execution_count: 9 }));
    await waitFor(() => expect(screen.queryByText('[9]:')).not.toBeInTheDocument());
    expect(screen.getByText('[0]:')).toBeInTheDocument();
  });

  it('reflects kernel status changes in the toolbar', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await waitFor(() => expect(container.querySelector('.ks-connected')).toBeInTheDocument());

    sockets[0].receive(kernelMessage('status', 'any', { execution_state: 'busy' }));
    await waitFor(() => expect(container.querySelector('.ks-busy')).toBeInTheDocument());
  });

  it('does not load or start anything when the tab is already loaded', async () => {
    render(<NotebookEditor data={{ ...tab, load_required: false }} />);

    await waitFor(() => expect(getNotebook).not.toHaveBeenCalled());
    expect(createSession).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });
});
