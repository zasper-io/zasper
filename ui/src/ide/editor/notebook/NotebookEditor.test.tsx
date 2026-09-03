import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookEditor from './NotebookEditor';
// Straight from the module, not through the mocked '@/api': this is what a failed request rejects
// with, and the banner is meant to read the reason out of it.
import { ApiError } from '@/api/client';
import { useRunCommand } from '@/commands/registry';
import { IKernelspecsState, kernelspecsAtom } from '@/store/AppState';
import { IfileTab } from '@/store/TabState';

/** The installed kernels, as /api/kernelspecs reports them: keyed by name. */
function installedKernelspecs(...names: string[]): IKernelspecsState {
  return Object.fromEntries(
    names.map((name) => [name, { name, spec: { display_name: name }, resources: {} }])
  );
}

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
const saveNotebook = vi.fn();

vi.mock('@/api', async () => ({
  getNotebook: (path: string) => getNotebook(path),
  createSession: (path: string, name: string, type: string, kernelspec: string) =>
    createSession(path, name, type, kernelspec),
  deleteSession: vi.fn(),
  interruptKernel: vi.fn(),
  saveNotebook: (path: string, notebook: unknown) => saveNotebook(path, notebook),
  // Not stubbed: what it extracts from a failed request is what the load-error banner shows.
  apiErrorMessage: (await import('@/api/client')).apiErrorMessage,
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

/**
 * Stands in for the keyboard and the command palette: a surface outside the notebook that only
 * knows a command id, dispatching through the registry the way they do.
 */
function Dispatcher({ id }: { id: string }) {
  const run = useRunCommand();
  // What the registry answered, so a test can tell a disabled command from an absent one.
  const [ran, setRan] = React.useState<boolean | null>(null);
  return (
    <button type="button" data-ran={String(ran)} onClick={() => setRan(run(id))}>
      dispatch
    </button>
  );
}

/** Clicks the Dispatcher above, i.e. runs its command id through the registry. */
function dispatch(): void {
  fireEvent.click(screen.getByText('dispatch'));
}

/** True if the last dispatch found an enabled command; false if it was refused. */
function dispatched(): string | undefined {
  return (screen.getByText('dispatch') as HTMLButtonElement).dataset.ran;
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

  // Every way of opening an existing notebook passes a kernelspec of 'none', so the file — not the
  // tab — is what a reopened notebook gets its kernel from.
  it('attaches the kernel the notebook was saved with', async () => {
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: tab.type,
      path: tab.path,
      content: {
        ...structuredClone(notebookContent),
        metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' } },
      },
    });

    render(<NotebookEditor data={{ ...tab, kernelspec: 'none' }} />);

    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith(
        'notebook.ipynb',
        'notebook.ipynb',
        'notebook',
        'python3'
      )
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(screen.queryByText('Current Kernel : none')).not.toBeInTheDocument();
  });

  it('asks which kernel to use when the saved one is not installed', async () => {
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: tab.type,
      path: tab.path,
      content: {
        ...structuredClone(notebookContent),
        metadata: { kernelspec: { name: 'python2', display_name: 'Python 2' } },
      },
    });

    render(
      <Provider initialValues={[[kernelspecsAtom, installedKernelspecs('python3')]]}>
        <NotebookEditor data={{ ...tab, kernelspec: 'none' }} />
      </Provider>
    );

    expect(await screen.findByText('Current Kernel : none')).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('offers the kernel picker when neither the tab nor the file names a kernel', async () => {
    render(<NotebookEditor data={{ ...tab, kernelspec: 'none' }} />);

    expect(await screen.findByText('Current Kernel : none')).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  // The picker would otherwise cover the error the reader is meant to see, with a modal asking
  // which kernel to run a notebook nobody could read.
  it('does not raise the kernel picker over a notebook that could not be loaded', async () => {
    getNotebook.mockRejectedValue(new ApiError('POST', '/api/contents', 400, ''));

    render(<NotebookEditor data={{ ...tab, kernelspec: 'none' }} />);

    await screen.findByRole('alert');
    expect(screen.queryByText('Current Kernel : none')).not.toBeInTheDocument();
  });

  it('does not load or start anything when the tab is already loaded', async () => {
    render(<NotebookEditor data={{ ...tab, load_required: false }} />);

    await waitFor(() => expect(getNotebook).not.toHaveBeenCalled());
    expect(createSession).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });
});

/**
 * The notebook's actions as commands, reached the way the keyboard and the palette reach them: by id
 * through the registry, with no reference to the editor that registered them.
 *
 * Each of these wraps in jotai's <Provider> because the registry is a global atom, and one notebook
 * left over from a previous test would answer for the one under test.
 */
describe('NotebookEditor commands', () => {
  beforeEach(() => {
    sockets.length = 0;
    resetIds();
    getNotebook.mockReset();
    createSession.mockReset();
    // Per path, so two notebooks open at once are told apart by their session, and so their cells
    // are told apart by their source.
    getNotebook.mockImplementation((path: string) =>
      Promise.resolve({
        name: path,
        type: 'notebook',
        path,
        content: {
          ...structuredClone(notebookContent),
          cells: [{ ...structuredClone(notebookContent.cells[0]), source: `run("${path}")` }],
        },
      })
    );
    createSession.mockImplementation((path: string) =>
      Promise.resolve({ ...session, id: `session-${path}`, path, name: path })
    );
    saveNotebook.mockReset();
    saveNotebook.mockResolvedValue(undefined);
  });

  function socketFor(path: string): IFakeSocket {
    const socket = sockets.find((candidate) =>
      candidate.url.includes(`session_id=session-${path}`)
    );
    if (!socket) {
      throw new Error(`no socket for ${path}, only: ${sockets.map((s) => s.url).join(', ')}`);
    }
    return socket;
  }

  it('runs the focused cell when a command is dispatched by id', async () => {
    render(
      <Provider>
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:run-cell" />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    dispatch();

    expect(dispatched()).toBe('true');
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const request = JSON.parse(sockets[0].sent[0]);
    expect(request.header.msg_type).toBe('execute_request');
    expect(request.content.code).toBe('run("notebook.ipynb")');
  });

  // The bug this design exists to kill: every open tab stays mounted, only hidden with CSS, so the
  // window listener that used to live in useNotebookCells fired in all of them at once — Ctrl-B
  // added a cell to every open notebook. Commands are registered only by the active tab.
  it('reaches the active notebook only, not the hidden ones', async () => {
    const hidden: IfileTab = { ...tab, path: 'hidden.ipynb', name: 'hidden.ipynb', active: false };

    render(
      <Provider>
        <NotebookEditor data={tab} />
        <NotebookEditor data={hidden} />
        <Dispatcher id="notebook:run-cell" />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByText('[0]:')).toHaveLength(2));

    dispatch();

    await waitFor(() => expect(socketFor('notebook.ipynb').sent).toHaveLength(1));
    expect(JSON.parse(socketFor('notebook.ipynb').sent[0]).content.code).toBe(
      'run("notebook.ipynb")'
    );
    expect(socketFor('hidden.ipynb').sent).toHaveLength(0);
  });

  it('refuses a command whose notebook has no kernel yet', async () => {
    // The session never resolves, so the notebook loads but nothing is connected.
    createSession.mockReturnValue(new Promise(() => {}));

    render(
      <Provider>
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:run-cell" />
      </Provider>
    );
    await screen.findByText('[0]:');

    dispatch();

    // Registered but refused — the palette shows it dimmed rather than hiding it.
    expect(dispatched()).toBe('false');
    expect(sockets).toHaveLength(0);
    // Not merely unsent: no spinner either, because the cell was never marked running.
    expect(document.querySelector('.spinner')).not.toBeInTheDocument();
  });

  // The server round-trips metadata it does not understand, so a save must not be the place it gets
  // dropped: everything the file arrived with is sent back, with only kernelspec updated.
  it('saves without discarding metadata it did not set', async () => {
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: tab.type,
      path: tab.path,
      content: {
        ...structuredClone(notebookContent),
        metadata: {
          kernelspec: { name: 'python2', display_name: 'Python 2' },
          language_info: { name: 'python', codemirror_mode: { name: 'ipython', version: 3 } },
          widgets: { state: {} },
        },
      },
    });

    render(
      <Provider>
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:save" />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    dispatch();

    await waitFor(() => expect(saveNotebook).toHaveBeenCalled());
    const [path, saved] = saveNotebook.mock.calls[0];
    expect(path).toBe('notebook.ipynb');
    expect(saved.metadata.language_info).toEqual({
      name: 'python',
      codemirror_mode: { name: 'ipython', version: 3 },
    });
    expect(saved.metadata.widgets).toEqual({ state: {} });
    // The one key the editor owns: the kernel actually attached, as nbformat spells it.
    expect(saved.metadata.kernelspec).toEqual({ name: 'python3', display_name: 'python3' });
  });

  // A failed read leaves the editor holding its empty starting state, so it has to say why — with
  // the server's own reason, not just the status — and must not write that state over the file.
  it('reports a notebook it could not load, and refuses to save over it', async () => {
    getNotebook.mockRejectedValue(
      new ApiError(
        'POST',
        '/api/contents',
        400,
        JSON.stringify({ message: 'not a valid notebook: unexpected end of JSON input' })
      )
    );

    render(
      <Provider>
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:save" />
      </Provider>
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('could not be loaded');
    expect(alert).toHaveTextContent('not a valid notebook: unexpected end of JSON input');

    dispatch();

    expect(dispatched()).toBe('false');
    expect(saveNotebook).not.toHaveBeenCalled();
    // And no kernel was started for it: there is nothing to run.
    expect(createSession).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });

  it('inserts a cell below the focused one', async () => {
    render(
      <Provider>
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:insert-cell-below" />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    dispatch();

    await waitFor(() => expect(screen.getAllByText('[0]:')).toHaveLength(2));
  });
});
