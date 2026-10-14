import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  // IRkernel aborts what is queued behind an error and sends no idle for it: the reply is the end.
  it('stops spinning a cell whose run the kernel aborted', async () => {
    const { container } = await openNotebook();
    act(() => sockets[0].receive(replay([])));
    act(() => runButton(container).click());
    await screen.findByText('[*]:');

    act(() =>
      sockets[0].receive(kernelMessage('execute_reply', firstRequestId, { status: 'aborted' }))
    );

    await waitFor(() => expect(screen.queryByText('[*]:')).toBeNull());
    expect(spinning(container)).toBe(false);
    // The queued mark, -1, is never shown as a count.
    expect(screen.getByText('[ ]:')).toBeInTheDocument();
  });

  it('asks again for an input() raised while nobody was looking, and sends the answer', async () => {
    await openNotebook();
    const prompt = {
      channel: 'stdin',
      header: { msg_id: 'prompt-1', msg_type: 'input_request' },
      parent_header: { msg_id: 'waiting-1' },
      content: { prompt: 'name? ', password: false },
    };

    act(() =>
      sockets[0].receive(
        replay([run({ msg_id: 'waiting-1', done: false, outputs: [], input_request: prompt })])
      )
    );
    const box = await screen.findByPlaceholderText('Type something and press Enter');
    fireEvent.change(box, { target: { value: 'Ada' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    const answer = sockets[0].sent
      .map((sent) => JSON.parse(sent))
      .find((message) => message.header.msg_type === 'input_reply');
    expect(answer?.content.value).toBe('Ada');
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

  it('reconnects a dropped socket, and settles a run that ended meanwhile', async () => {
    const { container } = await openNotebook();
    act(() => sockets[0].receive(replay([])));
    act(() => runButton(container).click());
    await screen.findByText('[*]:');

    act(() => sockets[0].drop());

    await waitFor(() => expect(sockets[1]?.opened).toBe(true), { timeout: 3000 });
    expect(getKernel).toHaveBeenCalledWith('kernel-1');
    act(() =>
      sockets[1].receive(replay([run({ msg_id: firstRequestId, outputs: [], execution_count: 1 })]))
    );

    expect(await screen.findByText('[1]:')).toBeInTheDocument();
    expect(screen.queryByText('[*]:')).toBeNull();
    expect(spinning(container)).toBe(false);
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
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('says why its kernel died, with what the kernel printed last, and does not reconnect', async () => {
    const { container } = await openNotebook();
    act(() => sockets[0].receive(replay([])));
    act(() => runButton(container).click());
    await screen.findByText('[*]:');
    getKernel.mockRejectedValue(
      new ApiError(
        'GET',
        '/api/kernels/kernel-1',
        410,
        JSON.stringify({
          error: 'Gone',
          message: 'The kernel stopped before it was ready: it exited with code 3.',
          output: 'error: no such flag NOTFOUND',
        })
      )
    );

    act(() => sockets[0].drop());

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent(
      'The kernel stopped before it was ready: it exited with code 3.'
    );
    expect(alert).toHaveTextContent('error: no such flag NOTFOUND');
    expect(screen.queryByText('[*]:')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sockets).toHaveLength(1);
  });

  it('rejoins the kernel that replaced its own, as after a restart from elsewhere', async () => {
    await openNotebook();
    const restarted = {
      ...session,
      id: 'session-2',
      kernel: { ...session.kernel, id: 'kernel-2' },
    };
    getKernel.mockRejectedValue(new ApiError('GET', '/api/kernels/kernel-1', 404, ''));
    sessionForPath.mockResolvedValue(restarted);
    createSession.mockResolvedValue(restarted);

    act(() => sockets[0].drop());

    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
    expect(sockets[1].url).toContain('kernel-2');
  });
});
