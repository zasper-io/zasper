import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookEditor from './NotebookEditor';
import { ApiError } from '@/api/client';
import { TrustState } from '@/api/trust';
import { trustAskAtom, trustAtom } from '@/store/trust';
import {
  createSession,
  deleteSession,
  FakeSocket,
  getNotebook,
  resetIds,
  sessionForPath,
  sockets,
  watcher,
} from './notebookEditorFakes';
import { notebookContent, runButton, session, tab } from './notebookEditorTestKit';

vi.mock('@/api', async () => (await import('./notebookEditorFakes')).apiModule());
vi.mock('uuid', async () => ({ v4: (await import('./notebookEditorFakes')).nextId }));
vi.mock('@uiw/react-codemirror', async () =>
  (await import('./notebookEditorFakes')).codeMirrorModule()
);
vi.mock('@/ide/useContentWatcher', async () =>
  (await import('./notebookEditorFakes')).contentWatcherModule()
);
vi.stubGlobal('WebSocket', FakeSocket);

const restricted: TrustState = {
  folder: '/home/me/work/analysis',
  trusted: false,
  by: '',
  trust_all: false,
  env: false,
  folders: [],
};
const untrusted = () =>
  new ApiError('POST', '/api/sessions', 403, '{"error":"untrusted","message":"not trusted"}');

function renderInStore() {
  const store = createStore();
  store.set(trustAtom, restricted);
  const view = render(
    <Provider store={store}>
      <NotebookEditor data={tab} />
    </Provider>
  );
  return { store, ...view };
}

describe('NotebookEditor in a folder that is not trusted', () => {
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
    deleteSession.mockReset();
    createSession.mockReset();
    createSession.mockRejectedValue(untrusted());
  });

  it('shows the notebook, says why there is no kernel, and raises no kernel error', async () => {
    renderInStore();

    expect(await screen.findByText('Restricted mode.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restricted/ })).toBeInTheDocument();
    expect(await screen.findByText('[0]:')).toBeInTheDocument();
    expect(screen.queryByText('Kernel Error')).toBeNull();
    expect(screen.queryByText('Switch Kernel')).toBeNull();
    expect(sockets).toHaveLength(0);
  });

  it('asks before running, and runs the cell once the folder is trusted', async () => {
    const { store, container } = renderInStore();
    await screen.findByText('Restricted mode.');
    await screen.findByText('[0]:');

    fireEvent.click(runButton(container));
    const ask = store.get(trustAskAtom);
    expect(ask?.reason).toBe('run');
    expect(sockets).toHaveLength(0);

    // What the trust question does once the folder is trusted.
    createSession.mockResolvedValue(session);
    act(() => {
      if (ask?.reason === 'run') {
        ask.onTrusted();
      }
      store.set(trustAtom, { ...restricted, trusted: true, by: 'folder' });
    });

    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(createSession).toHaveBeenLastCalledWith(
      'notebook.ipynb',
      'notebook.ipynb',
      'notebook',
      'python3'
    );
    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    expect(JSON.parse(sockets[0].sent[0]).header.msg_type).toBe('execute_request');
    expect(screen.queryByText('Restricted mode.')).toBeNull();
  });
});
