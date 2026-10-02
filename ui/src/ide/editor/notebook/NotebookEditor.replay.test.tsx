import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookEditor from './NotebookEditor';
import { ApiError } from '@/api/client';
import {
  createSession,
  deleteSession,
  FakeSocket,
  getKernel,
  getNotebook,
  resetIds,
  sessionForPath,
  sockets,
  watcher,
} from './notebookEditorFakes';
import {
  firstRequestId,
  kernelMessage,
  notebookContent,
  runButton,
  session,
  tab,
} from './notebookEditorTestKit';

vi.mock('@/api', async () => (await import('./notebookEditorFakes')).apiModule());
vi.mock('uuid', async () => ({ v4: (await import('./notebookEditorFakes')).nextId }));
vi.mock('@uiw/react-codemirror', async () =>
  (await import('./notebookEditorFakes')).codeMirrorModule()
);
vi.mock('@/ide/useContentWatcher', async () =>
  (await import('./notebookEditorFakes')).contentWatcherModule()
);

vi.stubGlobal('WebSocket', FakeSocket);

const replay = (runs: unknown[]) => ({
  channel: 'zasper',
  header: { msg_type: 'zasper_replay' },
  content: { runs },
});

const run = (overrides: Record<string, unknown>) => ({
  msg_id: 'kept-1',
  cell_id: 'server-cell-id',
  code: 'print("hi")',
  execution_count: 4,
  outputs: [{ output_type: 'stream', name: 'stdout', text: 'while you were away\n' }],
  clear_waiting: false,
  done: true,
  ...overrides,
});

const spinning = (container: HTMLElement) => container.querySelector('.z-spinner') !== null;

async function openNotebook() {
  const rendered = render(<NotebookEditor data={tab} />);
  await waitFor(() => expect(sockets[0]?.opened).toBe(true));
  await screen.findByText('[0]:');
  return rendered;
}

describe('NotebookEditor, given the runs it missed', () => {
  beforeEach(() => {
    sockets.length = 0;
    watcher.fire = () => {};
    resetIds();
    getNotebook.mockReset();
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: tab.type,
      path: tab.path,
      content: structuredClone(notebookContent),
    });
    sessionForPath.mockReset();
    sessionForPath.mockResolvedValue(undefined);
    createSession.mockReset();
    createSession.mockResolvedValue(session);
    deleteSession.mockReset();
    deleteSession.mockResolvedValue(undefined);
    getKernel.mockReset();
    getKernel.mockResolvedValue(session.kernel);
  });

  it('shows the output of a run that finished while nobody was looking', async () => {
    const { container } = await openNotebook();

    act(() => sockets[0].receive(replay([run({})])));

    expect(await screen.findByText(/while you were away/)).toBeInTheDocument();
    expect(screen.getByText('[4]:')).toBeInTheDocument();
    expect(spinning(container)).toBe(false);
  });

  it('follows a run that is still going into its cell', async () => {
    const { container } = await openNotebook();

    act(() => sockets[0].receive(replay([run({ msg_id: 'going-1', done: false })])));
    await waitFor(() => expect(spinning(container)).toBe(true));

    act(() =>
      sockets[0].receive(
        kernelMessage('stream', 'going-1', { name: 'stdout', text: 'and now this\n' })
      )
    );
    expect(await screen.findByText(/and now this/)).toBeInTheDocument();
    expect(screen.getByText(/while you were away/)).toBeInTheDocument();

    act(() => sockets[0].receive(kernelMessage('status', 'going-1', { execution_state: 'idle' })));
    await waitFor(() => expect(spinning(container)).toBe(false));
  });

  it('places a run in a notebook without cell ids by the code that ran', async () => {
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: tab.type,
      path: tab.path,
      content: {
        ...structuredClone(notebookContent),
        nbformat_minor: 4,
        cells: [{ ...structuredClone(notebookContent.cells[0]), id: undefined }],
      },
    });
    await openNotebook();

    act(() => sockets[0].receive(replay([run({ cell_id: 'an-id-from-another-tab' })])));

    expect(await screen.findByText(/while you were away/)).toBeInTheDocument();
  });

  it('reconnects a dropped socket, and stops a spinner whose run ended meanwhile', async () => {
    const { container } = await openNotebook();
    act(() => sockets[0].receive(replay([])));
    act(() => runButton(container).click());
    await waitFor(() => expect(spinning(container)).toBe(true));

    act(() => sockets[0].drop());

    await waitFor(() => expect(sockets[1]?.opened).toBe(true), { timeout: 3000 });
    expect(getKernel).toHaveBeenCalledWith('kernel-1');
    act(() =>
      sockets[1].receive(replay([run({ msg_id: firstRequestId, outputs: [], execution_count: 1 })]))
    );

    await waitFor(() => expect(spinning(container)).toBe(false));
    expect(screen.getByText('[1]:')).toBeInTheDocument();
  });

  it('lets go of its socket when the page is put in the back/forward cache', async () => {
    await openNotebook();

    act(() => {
      const hide = new Event('pagehide') as Event & { persisted: boolean };
      Object.defineProperty(hide, 'persisted', { value: true });
      window.dispatchEvent(hide);
    });

    expect(sockets[0].closed).toBe(true);
  });

  it('does not reconnect to a kernel that has stopped', async () => {
    getKernel.mockRejectedValue(new ApiError('GET', '/api/kernels/kernel-1', 404, ''));
    await openNotebook();

    act(() => sockets[0].drop());

    await waitFor(() => expect(getKernel).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sockets).toHaveLength(1);
  });
});
