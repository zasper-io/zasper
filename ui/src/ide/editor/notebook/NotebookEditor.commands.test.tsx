import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from '@/testing/Provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookEditor from './NotebookEditor';
import { FileTab } from '@/store/tabState';
import { ApiError } from '@/api/client';
import { kernelspecsAtom } from '@/store/kernels';
import {
  createSession,
  deleteSession,
  FakeSocket,
  getNotebook,
  RecordedSocket,
  resetIds,
  saveNotebook,
  sessionForPath,
  sockets,
} from './notebookEditorFakes';
import {
  dispatch,
  dispatched,
  Dispatcher,
  installedKernelspecs,
  notebookContent,
  session,
  tab,
} from './notebookEditorTestKit';

vi.mock('@/api', async () => (await import('./notebookEditorFakes')).apiModule());
vi.mock('uuid', async () => ({ v4: (await import('./notebookEditorFakes')).nextId }));
vi.mock('@uiw/react-codemirror', async () =>
  (await import('./notebookEditorFakes')).codeMirrorModule()
);

vi.stubGlobal('WebSocket', FakeSocket);

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
    sessionForPath.mockReset();
    // No session on this path, i.e. a notebook being opened for the first time.
    sessionForPath.mockResolvedValue(undefined);
    createSession.mockReset();
    deleteSession.mockReset();
    deleteSession.mockResolvedValue(undefined);
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

  function socketFor(path: string): RecordedSocket {
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

  // What this design exists to prevent: every open tab stays mounted, only hidden with CSS, so a
  // window listener in each would fire in all of them at once. Only the active tab registers commands.
  it('reaches the active notebook only, not the hidden ones', async () => {
    const hidden: FileTab = { ...tab, path: 'hidden.ipynb', name: 'hidden.ipynb', active: false };

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

  // The session the notebook is leaving has to end: abandoning it leaves a kernel running with nothing
  // attached and two sessions on one path for the server to choose between.
  it('ends the old session before switching a notebook to another kernel', async () => {
    render(
      <Provider initialValues={[[kernelspecsAtom, installedKernelspecs('python3', 'ir')]]}>
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:change-kernel" />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));

    dispatch();
    const dialog = within(document.querySelector('.modal') as HTMLElement);
    fireEvent.change(dialog.getByRole('combobox'), { target: { value: 'ir' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Switch Kernel' }));

    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('session-notebook.ipynb'));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
    expect(createSession.mock.calls[1][3]).toBe('ir');
  });

  // It had no keyboard dismissal at all until the overlays were ported, along with two of the other
  // seven dialogs: the close cross was the only way out of it.
  it('closes the kernel switcher on Escape, leaving the kernel it already has', async () => {
    render(
      <Provider initialValues={[[kernelspecsAtom, installedKernelspecs('python3', 'ir')]]}>
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:change-kernel" />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    dispatch();
    expect(document.querySelector('.modal')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(document.querySelector('.modal')).toBeNull();
    expect(deleteSession).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);
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
    expect(document.querySelector('.z-spinner')).not.toBeInTheDocument();
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

  // A notebook written by Jupyter records more under kernelspec than a name: rebuilding the object
  // turned `Python 3` into `python3` and dropped `language` on every save of an unmodified file.
  it('keeps the kernelspec the file came with when it names the attached kernel', async () => {
    const kernelspec = { name: 'python3', display_name: 'Python 3', language: 'python' };
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: tab.type,
      path: tab.path,
      content: { ...structuredClone(notebookContent), metadata: { kernelspec } },
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
    expect(saveNotebook.mock.calls[0][1].metadata.kernelspec).toEqual(kernelspec);
  });

  // A file that names another kernel does get its kernelspec rewritten, and `name` there is the
  // kernel's id: the display name to write beside it is the installed kernel's own.
  it('records the display name of the kernel it attached', async () => {
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: tab.type,
      path: tab.path,
      content: {
        ...structuredClone(notebookContent),
        metadata: { kernelspec: { name: 'deno', display_name: 'Deno' } },
      },
    });

    render(
      <Provider
        initialValues={[
          [
            kernelspecsAtom,
            { python3: { name: 'python3', spec: { display_name: 'Python 3' }, resources: {} } },
          ],
        ]}
      >
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:save" />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    dispatch();

    await waitFor(() => expect(saveNotebook).toHaveBeenCalled());
    expect(saveNotebook.mock.calls[0][1].metadata.kernelspec).toEqual({
      name: 'python3',
      display_name: 'Python 3',
    });
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

    // A null count is nbformat's "has not run"; the loaded cell keeps the count the file gave it.
    await waitFor(() => expect(screen.getByText('[ ]:')).toBeInTheDocument());
    expect(screen.getByText('[0]:')).toBeInTheDocument();
  });

  // From nbformat 4.5 the ids belong to the document, and are what another client's diffs and
  // comments are keyed to, so a file must go back with the ones it arrived with.
  it('saves the cell ids the file arrived with', async () => {
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
    expect(saveNotebook.mock.calls[0][1].cells.map((cell: { id: string }) => cell.id)).toEqual([
      'server-cell-id',
    ]);
  });
});
