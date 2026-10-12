import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { Provider } from '@/testing/Provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookEditor from './NotebookEditor';
import { ApiError } from '@/api/client';
import { unsavedTabsAtom } from '@/store/unsavedState';
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
import { dispatch, Dispatcher, notebookContent, session, tab } from './notebookEditorTestKit';

vi.mock('@/api', async () => (await import('./notebookEditorFakes')).apiModule());
vi.mock('uuid', async () => ({ v4: (await import('./notebookEditorFakes')).nextId }));
vi.mock('@uiw/react-codemirror', async () =>
  (await import('./notebookEditorFakes')).codeMirrorModule()
);
vi.mock('@/ide/useContentWatcher', async () =>
  (await import('./notebookEditorFakes')).contentWatcherModule()
);

vi.stubGlobal('WebSocket', FakeSocket);

/** Reads the unsaved tabs the way the tab bar does: from the atom, outside the editor. */
describe('NotebookEditor unsaved changes', () => {
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
      hash: 'hash as read',
    });
    createSession.mockResolvedValue(session);
    saveNotebook.mockReset();
    saveNotebook.mockResolvedValue('hash after the save');
  });

  function Unsaved() {
    return <div data-testid="unsaved">{Object.keys(useAtomValue(unsavedTabsAtom)).join(',')}</div>;
  }

  /** The paths the tab bar would prompt about, as one string. */
  function unsavedPaths(): string {
    return screen.getByTestId('unsaved').textContent ?? '';
  }

  async function renderNotebook(commandId: string) {
    render(
      <Provider>
        <NotebookEditor data={tab} />
        <Dispatcher id={commandId} />
        <Unsaved />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');
  }

  it('holds nothing unsaved when the file has only just been read', async () => {
    await renderNotebook('notebook:save');

    expect(unsavedPaths()).toBe('');
  });

  it('is unsaved as soon as the document changes', async () => {
    await renderNotebook('notebook:insert-cell-below');

    dispatch();

    await waitFor(() => expect(unsavedPaths()).toBe('notebook.ipynb'));
  });

  it('is saved again once the write has gone through', async () => {
    render(
      <Provider>
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:insert-cell-below" />
        <Dispatcher id="notebook:save" />
        <Unsaved />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(screen.getAllByText('dispatch')[0]);
    await waitFor(() => expect(unsavedPaths()).toBe('notebook.ipynb'));

    fireEvent.click(screen.getAllByText('dispatch')[1]);

    await waitFor(() => expect(saveNotebook).toHaveBeenCalled());
    await waitFor(() => expect(unsavedPaths()).toBe(''));
  });

  // The server refused the write, so the editor still holds the only copy.
  it('stays unsaved when the write failed', async () => {
    saveNotebook.mockRejectedValue(new ApiError('PUT', '/api/contents', 403, 'read-only'));
    render(
      <Provider>
        <NotebookEditor data={tab} />
        <Dispatcher id="notebook:insert-cell-below" />
        <Dispatcher id="notebook:save" />
        <Unsaved />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByText('[0]:');

    fireEvent.click(screen.getAllByText('dispatch')[0]);
    await waitFor(() => expect(unsavedPaths()).toBe('notebook.ipynb'));

    fireEvent.click(screen.getAllByText('dispatch')[1]);

    await waitFor(() => expect(saveNotebook).toHaveBeenCalled());
    expect(unsavedPaths()).toBe('notebook.ipynb');
  });

  describe('a save over a change it has not seen', () => {
    function renderWithSave() {
      render(
        <Provider>
          <NotebookEditor data={tab} />
          <Dispatcher id="notebook:insert-cell-below" />
          <Dispatcher id="notebook:save" />
          <Unsaved />
        </Provider>
      );
    }

    function anAgentWrote(source: string) {
      saveNotebook.mockRejectedValueOnce(new ApiError('PUT', '/api/contents', 409, ''));
      const theirs = structuredClone(notebookContent);
      theirs.cells[0].source = source;
      getNotebook.mockResolvedValue({ ...tab, content: theirs, hash: 'hash of theirs' });
    }

    it('brings in a cell only the file changed, and saves both', async () => {
      renderWithSave();
      await waitFor(() => expect(sockets).toHaveLength(1));
      await screen.findByText('[0]:');
      fireEvent.click(screen.getAllByText('dispatch')[0]);
      await waitFor(() => expect(unsavedPaths()).toBe('notebook.ipynb'));

      anAgentWrote('written by an agent');
      fireEvent.click(screen.getAllByText('dispatch')[1]);

      await waitFor(() => expect(unsavedPaths()).toBe(''));
      expect(saveNotebook.mock.calls[0][2]).toBe('hash as read');
      const [, written, hash] = saveNotebook.mock.calls[1];
      expect(hash).toBe('hash of theirs');
      expect(written.cells.map((cell: { source: string }) => cell.source)).toEqual([
        'written by an agent',
        '',
      ]);
    });

    describe('when a cell changed on both sides', () => {
      async function saveOverAConflict() {
        renderWithSave();
        await waitFor(() => expect(sockets).toHaveLength(1));
        await screen.findByText('[0]:');
        fireEvent.change(screen.getByDisplayValue('print("hi")'), {
          target: { value: 'print("mine")' },
        });
        await waitFor(() => expect(unsavedPaths()).toBe('notebook.ipynb'));

        anAgentWrote('print("theirs")');
        fireEvent.click(screen.getAllByText('dispatch')[1]);
        await screen.findByText(`${tab.name} was not saved.`);
      }

      it('writes nothing more, says so, and asks on the cell', async () => {
        await saveOverAConflict();

        expect(saveNotebook).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Changed on both sides.')).toBeInTheDocument();
        expect(unsavedPaths()).toBe('notebook.ipynb');
      });

      it('saves over the version now on disk once the reader keeps theirs', async () => {
        await saveOverAConflict();

        fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
        fireEvent.click(screen.getAllByText('dispatch')[1]);

        await waitFor(() => expect(unsavedPaths()).toBe(''));
        expect(saveNotebook.mock.calls[1][2]).toBe('hash of theirs');
        expect(saveNotebook.mock.calls[1][1].cells[0].source).toBe('print("mine")');
      });
    });
  });
});
