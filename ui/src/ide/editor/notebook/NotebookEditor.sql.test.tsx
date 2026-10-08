import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookEditor from './NotebookEditor';
import { connectionsAtom } from '@/store/connections';
import {
  createSession,
  deleteSession,
  FakeSocket,
  getNotebook,
  prepareConnection,
  resetIds,
  sessionForPath,
  sockets,
  watcher,
} from './notebookEditorFakes';
import { runButton, session, tab } from './notebookEditorTestKit';

vi.mock('@/api', async () => (await import('./notebookEditorFakes')).apiModule());
vi.mock('uuid', async () => ({ v4: (await import('./notebookEditorFakes')).nextId }));
vi.mock('@uiw/react-codemirror', async () =>
  (await import('./notebookEditorFakes')).codeMirrorModule()
);
vi.mock('@/ide/useContentWatcher', async () =>
  (await import('./notebookEditorFakes')).contentWatcherModule()
);
vi.stubGlobal('WebSocket', FakeSocket);

const sqlSource = '%%zasper_sql analytics --out df_orders --limit 1000\nSELECT * FROM orders';

function notebookWith(outputs: unknown[] = []) {
  return {
    cells: [
      {
        cell_type: 'code',
        id: 'sql-cell',
        execution_count: 3,
        source: sqlSource,
        outputs,
        metadata: {},
      },
    ],
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
  };
}

function renderNotebook(outputs: unknown[] = []) {
  getNotebook.mockResolvedValue({
    name: tab.name,
    type: tab.type,
    path: tab.path,
    content: notebookWith(outputs),
  });
  const store = createStore();
  store.set(connectionsAtom, {
    types: ['postgresql'],
    connections: [{ name: 'analytics', type: 'postgresql', host: 'db', scope: 'project' }],
  });
  return render(
    <Provider store={store}>
      <NotebookEditor data={tab} />
    </Provider>
  );
}

describe('a SQL cell in a notebook', () => {
  beforeEach(() => {
    sockets.length = 0;
    watcher.fire = () => {};
    resetIds();
    getNotebook.mockReset();
    sessionForPath.mockReset();
    sessionForPath.mockResolvedValue(undefined);
    deleteSession.mockReset();
    createSession.mockReset();
    createSession.mockResolvedValue(session);
    prepareConnection.mockReset();
    prepareConnection.mockResolvedValue({ ok: true });
  });

  it('shows what it runs on and what it makes, and says SQL in the type select', async () => {
    renderNotebook();

    expect(await screen.findByRole('button', { name: 'Run on analytics' })).toHaveTextContent(
      'PostgreSQL'
    );
    expect(screen.getByRole('textbox', { name: 'Dataframe' })).toHaveValue('df_orders');
    expect(screen.getByRole('combobox', { name: 'Cell type' })).toHaveValue('sql');
  });

  it('hands the kernel its connection before sending the query', async () => {
    const { container } = renderNotebook();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await screen.findByRole('button', { name: 'Run on analytics' });

    fireEvent.click(runButton(container));

    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    expect(prepareConnection).toHaveBeenCalledWith('kernel-1', 'analytics');
    expect(JSON.parse(sockets[0].sent[0]).content.code).toBe(sqlSource);
  });

  it('says where its rows came from, and Load all runs it again without its limit', async () => {
    renderNotebook([
      {
        output_type: 'display_data',
        data: {
          'application/vnd.zasper.sql+json': {
            connection: 'analytics',
            out: 'df_orders',
            rows: 1000,
            more: true,
            limit: 1000,
            seconds: 0.8,
            cached: false,
            ran_at: 0,
          },
          'text/plain': 'df_orders · analytics · first 1,000 rows, more available',
        },
        metadata: {},
      },
    ]);
    await waitFor(() => expect(sockets).toHaveLength(1));

    expect(
      await screen.findByText(/first 1,000 rows, more available · 0\.8 s/)
    ).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Load all' }));
    });

    await waitFor(() => expect(sockets[0].sent).toHaveLength(1));
    expect(JSON.parse(sockets[0].sent[0]).content.code).toBe(
      '%%zasper_sql analytics --out df_orders --limit none\nSELECT * FROM orders'
    );
  });

  it('shows a refused query in the database’s own words, and offers to install a missing driver', async () => {
    renderNotebook([
      {
        output_type: 'error',
        ename: 'SqlError',
        evalue: 'psycopg[binary] is not installed in /env/bin/python',
        traceback: ['psycopg[binary] is not installed in /env/bin/python'],
      },
    ]);
    await waitFor(() => expect(sockets).toHaveLength(1));

    expect(
      await screen.findByText('psycopg[binary] is not installed in /env/bin/python')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install psycopg[binary]' })).toBeInTheDocument();
  });
});
