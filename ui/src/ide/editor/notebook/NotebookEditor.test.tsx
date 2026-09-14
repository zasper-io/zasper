import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from '@/testing/Provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookEditor from './NotebookEditor';
import { ApiError } from '@/api/client';
import { kernelspecsAtom } from '@/store/kernels';
import {
  createSession,
  deleteSession,
  FakeSocket,
  getNotebook,
  resetIds,
  saveNotebook,
  sessionForPath,
  sockets,
} from './notebookEditorFakes';
import {
  dispatch,
  Dispatcher,
  firstRequestId,
  installedKernelspecs,
  kernelMessage,
  notebookContent,
  requestIdOf,
  runButton,
  session,
  tab,
} from './notebookEditorTestKit';

vi.mock('@/api', async () => (await import('./notebookEditorFakes')).apiModule());
vi.mock('uuid', async () => ({ v4: (await import('./notebookEditorFakes')).nextId }));
vi.mock('@uiw/react-codemirror', async () =>
  (await import('./notebookEditorFakes')).codeMirrorModule()
);

vi.stubGlobal('WebSocket', FakeSocket);

describe('NotebookEditor', () => {
  beforeEach(() => {
    sockets.length = 0;
    resetIds();
    getNotebook.mockReset();
    sessionForPath.mockReset();
    // No session on this path, i.e. a notebook being opened for the first time.
    sessionForPath.mockResolvedValue(undefined);
    createSession.mockReset();
    deleteSession.mockReset();
    deleteSession.mockResolvedValue(undefined);
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

  /*
   * Reopening a notebook whose kernel outlived its tab, which is what closing a tab now leaves behind.
   * Both the tab and the file say `python3`, and neither gets a say: the session's kernel is the one
   * asked for, because that name is what makes the server hand back the session it already has.
   */
  it('joins the session already running the notebook', async () => {
    sessionForPath.mockResolvedValue({ ...session, kernel: { id: 'kernel-9', name: 'deno' } });

    render(<NotebookEditor data={tab} />);

    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(sessionForPath).toHaveBeenCalledWith('notebook.ipynb');
    expect(createSession).toHaveBeenCalledWith(
      'notebook.ipynb',
      'notebook.ipynb',
      'notebook',
      'deno'
    );
  });

  // Asking is not required to start: before kernels outlived tabs there was nothing to ask.
  it('starts the notebook’s own kernel when it cannot ask what is running', async () => {
    sessionForPath.mockRejectedValue(new ApiError('GET', '/api/sessions', 500, 'nope'));

    render(<NotebookEditor data={tab} />);

    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(createSession).toHaveBeenCalledWith(
      'notebook.ipynb',
      'notebook.ipynb',
      'notebook',
      'python3'
    );
  });

  /*
   * The kernel survives the tab; the socket does not. Nothing else closes one — the server keeps a
   * kernel whose client has gone away — so a notebook opened and closed all afternoon would hold a
   * socket for every time.
   */
  // Waits for the socket to open, so the order is certain: it used to unmount as soon as the socket
  // existed, which on a fast machine was before it opened and failed on the bug below.
  it('closes the kernel socket when the notebook goes away, and leaves the session alone', async () => {
    const { unmount } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets[0]?.opened).toBe(true));

    unmount();

    expect(sockets[0].closed).toBe(true);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  // The other order: a tab closed while its kernel was still connecting. That socket was not yet the
  // notebook's connection, so nothing closed it.
  it('closes a kernel socket that has not opened yet when the notebook goes away', async () => {
    FakeSocket.autoOpen = false;
    try {
      const { unmount } = render(<NotebookEditor data={tab} />);
      await waitFor(() => expect(sockets).toHaveLength(1));

      unmount();

      expect(sockets[0].opened).toBe(false);
      expect(sockets[0].closed).toBe(true);
    } finally {
      FakeSocket.autoOpen = true;
    }
  });

  // Reordering, which the notebook had no way to do before: the chevrons in the cell toolbar move the
  // selection and nothing moved the cell. The focus follows the cell so the move can be repeated, and
  // it is undoable like every other structural change.
  it('moves the focused cell up and down, and takes the focus with it', async () => {
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: tab.type,
      path: tab.path,
      content: {
        ...structuredClone(notebookContent),
        cells: ['first', 'second', 'third'].map((name, index) => ({
          ...structuredClone(notebookContent.cells[0]),
          id: `cell-${name}`,
          source: `print("${name}")`,
          execution_count: index,
        })),
      },
    });
    saveNotebook.mockReset();
    saveNotebook.mockResolvedValue(undefined);

    render(
      <Provider>
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:move-cell-down" />
        <Dispatcher id="notebook:undo-cell-change" />
        <Dispatcher id="notebook:save" />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    const [moveDown, undo, save] = screen.getAllByText('dispatch');

    // The first cell is the focused one on open, so this swaps it with the second.
    fireEvent.click(moveDown);
    fireEvent.click(save);
    await waitFor(() => expect(saveNotebook).toHaveBeenCalled());
    expect(saveNotebook.mock.calls[0][1].cells.map((c: { id: string }) => c.id)).toEqual([
      'cell-second',
      'cell-first',
      'cell-third',
    ]);

    // The focus moved with the cell, so a second press carries the same cell one further down
    // rather than picking up whatever is now in first place.
    fireEvent.click(moveDown);
    saveNotebook.mockClear();
    fireEvent.click(save);
    await waitFor(() => expect(saveNotebook).toHaveBeenCalled());
    expect(saveNotebook.mock.calls[0][1].cells.map((c: { id: string }) => c.id)).toEqual([
      'cell-second',
      'cell-third',
      'cell-first',
    ]);

    fireEvent.click(undo);
    saveNotebook.mockClear();
    fireEvent.click(save);
    await waitFor(() => expect(saveNotebook).toHaveBeenCalled());
    expect(saveNotebook.mock.calls[0][1].cells.map((c: { id: string }) => c.id)).toEqual([
      'cell-second',
      'cell-first',
      'cell-third',
    ]);
  });

  // A new notebook is `"cells": []` on disk; the cell to type into comes from the frontend.
  it('shows one empty code cell for a notebook that has none', async () => {
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: tab.type,
      path: tab.path,
      content: { ...structuredClone(notebookContent), cells: [] },
    });

    const { container } = render(<NotebookEditor data={tab} />);

    // An empty bracket, not `[0]:`: the cell has not run.
    expect(await screen.findByText('[ ]:')).toBeInTheDocument();
    expect(container.querySelectorAll('.single-line')).toHaveLength(1);
  });

  it('sends an execute request for the cell that was run', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(runButton(container));

    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const request = JSON.parse(sockets[0].sent[0]);
    expect(request.header.msg_type).toBe('execute_request');
    expect(request.header.msg_id).toBe(firstRequestId);
    expect(request.header.session).toBe('session-1');
    expect(request.content.code).toBe('print("hi")');
    // The cell id goes in the metadata, where other Jupyter clients put it; the msg_id identifies
    // the request, not the cell.
    expect(request.metadata.cellId).toBe('server-cell-id');
    // The cell waits on the kernel: no execution count, spinner instead.
    expect(container.querySelector('.z-spinner')).toBeInTheDocument();
  });

  it('runs the focused cell from the toolbar', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    // Scoped to the toolbar: a cell's gutter carries a Run Cell button of its own now, and this test
    // is about the one that acts on whatever holds the focus.
    const toolbar = container.querySelector('.text-editor-tool') as HTMLElement;
    fireEvent.click(within(toolbar).getByLabelText('Run Cell'));

    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const request = JSON.parse(sockets[0].sent[0]);
    expect(request.header.msg_type).toBe('execute_request');
    expect(request.header.msg_id).toBe(firstRequestId);
    expect(request.content.code).toBe('print("hi")');
  });

  it('renders kernel output for the cell that requested it', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(runButton(container));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const requestId = requestIdOf(sockets[0], 0);

    // The count arrives while the cell is still running, and a running cell shows a spinner in the
    // gutter rather than a number — the count only becomes visible once the kernel goes idle.
    sockets[0].receive(kernelMessage('execute_input', requestId, { execution_count: 3 }));
    expect(await screen.findByLabelText('Running')).toBeInTheDocument();

    sockets[0].receive(
      kernelMessage('stream', requestId, { name: 'stdout', text: 'hello from kernel' })
    );
    expect(await screen.findByText('hello from kernel')).toBeInTheDocument();

    sockets[0].receive(kernelMessage('status', requestId, { execution_state: 'idle' }));
    expect(await screen.findByText('[3]:')).toBeInTheDocument();
  });

  // A colour the kernel asked for has to arrive as a class, not as `style="color:rgb(0,187,0)"`: an
  // inline colour is a 16-colour terminal palette baked into the output, which no theme can reach and
  // no contrast rule can touch. --z-ansi-* in styles/_tokens.scss is the other half.
  it('renders an ansi colour in stream output as a class rather than an inline colour', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(runButton(container));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const requestId = requestIdOf(sockets[0], 0);

    sockets[0].receive(
      kernelMessage('stream', requestId, { name: 'stdout', text: '\x1b[32mpassed\x1b[0m' })
    );

    const coloured = await waitFor(() => {
      const found = container.querySelector('.ansi-green-fg');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(coloured.textContent).toBe('passed');
    expect(coloured.getAttribute('style')).toBeNull();
  });

  // An error output is the app's failure shape — a red `ename` and a 2px edge — and the traceback under
  // it keeps the editor's ink, because 40 lines of red is 40 lines nobody reads.
  it('renders an error output as a named error, not as a heading', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(runButton(container));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const requestId = requestIdOf(sockets[0], 0);

    sockets[0].receive(
      kernelMessage('error', requestId, {
        ename: 'KeyError',
        evalue: "'b-03'",
        traceback: ['Traceback (most recent call last):', '  File "<ipython-input-1>", line 1'],
      })
    );

    const box = await waitFor(() => {
      const found = container.querySelector('.output-error');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(box.querySelector('.ename')?.textContent).toBe("KeyError: 'b-03'");
    expect(box.querySelector('h6')).toBeNull();
    expect(box.textContent).toContain('File "<ipython-input-1>", line 1');
  });

  // A cell that clears its own output — a progress line rewritten in a loop — used to append instead,
  // leaving every frame of the animation on screen.
  it('clears a cell output area on clear_output', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(runButton(container));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const requestId = requestIdOf(sockets[0], 0);

    sockets[0].receive(kernelMessage('stream', requestId, { name: 'stdout', text: 'frame 1' }));
    expect(await screen.findByText('frame 1')).toBeInTheDocument();

    sockets[0].receive(kernelMessage('clear_output', requestId, { wait: false }));
    await waitFor(() => expect(screen.queryByText('frame 1')).not.toBeInTheDocument());
  });

  // wait=True is the whole point of the flag: what is shown stays until there is something to put in
  // its place, so a cell redrawn on every iteration does not blink empty between frames.
  it('holds a waiting clear until there is an output to replace what is shown', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(runButton(container));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const requestId = requestIdOf(sockets[0], 0);

    sockets[0].receive(kernelMessage('stream', requestId, { name: 'stdout', text: 'frame 1' }));
    expect(await screen.findByText('frame 1')).toBeInTheDocument();

    sockets[0].receive(kernelMessage('clear_output', requestId, { wait: true }));
    // Still shown: nothing has arrived to take its place.
    expect(screen.getByText('frame 1')).toBeInTheDocument();

    sockets[0].receive(kernelMessage('stream', requestId, { name: 'stdout', text: 'frame 2' }));
    expect(await screen.findByText('frame 2')).toBeInTheDocument();
    expect(screen.queryByText('frame 1')).not.toBeInTheDocument();
  });

  // A reply reaches a cell only through the request it answers, so one answering nothing this editor
  // sent reaches no cell.
  it('ignores output that answers no request it sent', async () => {
    render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    sockets[0].receive(kernelMessage('execute_input', 'server-cell-id', { execution_count: 9 }));
    await waitFor(() => expect(screen.queryByText('[9]:')).not.toBeInTheDocument());
    expect(screen.getByText('[0]:')).toBeInTheDocument();
  });

  // `input()` in a cell: the prompt belongs under the cell whose request the input_request answers,
  // and the reply is addressed back to that request.
  it('prompts under the cell the kernel is waiting on, and answers its request', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(runButton(container));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const requestId = requestIdOf(sockets[0], 0);

    sockets[0].receive(kernelMessage('input_request', requestId, { prompt: 'name: ' }));

    const box = await screen.findByPlaceholderText('Type something and press Enter');
    fireEvent.change(box, { target: { value: 'Ada' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() => expect(sockets[0].sent).toHaveLength(2));
    const reply = JSON.parse(sockets[0].sent[1]);
    expect(reply.channel).toBe('stdin');
    expect(reply.header.msg_type).toBe('input_reply');
    expect(reply.content.value).toBe('Ada');
    expect(reply.parent_header.msg_id).toBe(requestId);
    // Its own id, not the id of the request it answers.
    expect(reply.header.msg_id).not.toBe(requestId);
  });

  // A request ends when the kernel reports itself idle for it, and stops addressing a cell from then
  // on — which is why a cell id, reused across every run, cannot serve as the msg_id.
  it('stops routing a request once the kernel reports it finished', async () => {
    const { container } = render(<NotebookEditor data={tab} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(runButton(container));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    const requestId = requestIdOf(sockets[0], 0);

    sockets[0].receive(kernelMessage('status', requestId, { execution_state: 'idle' }));
    sockets[0].receive(
      kernelMessage('stream', requestId, { name: 'stdout', text: 'too late to show' })
    );

    await waitFor(() => expect(container.querySelector('.ks-idle')).toBeInTheDocument());
    expect(screen.queryByText('too late to show')).not.toBeInTheDocument();
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

  // Two modals used to open here — an error dialog and the picker — stacked on one backdrop, and
  // dismissing either left the other.
  it('raises one dialog when the kernel cannot be started, with the reason in it', async () => {
    createSession.mockRejectedValue(
      new ApiError('POST', '/api/sessions', 500, '{"message":"kernel died on startup"}')
    );

    render(<NotebookEditor data={tab} />);

    expect(await screen.findByText('Kernel Error')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('kernel died on startup');
    expect(document.querySelectorAll('.modal')).toHaveLength(1);
    // And the picker it is: the only useful thing to do next is choose another kernel.
    expect(screen.getByText('Switch Kernel')).toBeInTheDocument();
  });

  it('does not load or start anything when the tab is already loaded', async () => {
    render(<NotebookEditor data={{ ...tab, load_required: false }} />);

    await waitFor(() => expect(getNotebook).not.toHaveBeenCalled());
    expect(createSession).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });
});
