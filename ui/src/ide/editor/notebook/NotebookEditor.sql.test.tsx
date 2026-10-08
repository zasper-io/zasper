import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookEditor from './NotebookEditor';
import { connectionsAtom } from '@/store/connections';
import {
  createSession,
  deleteSession,
  FakeSocket,
  getNotebook,
  countRows,
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

function notebookWith(outputs: unknown[] = [], others: unknown[] = []) {
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
      ...others,
    ],
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
  };
}

function renderNotebook(outputs: unknown[] = [], others: unknown[] = []) {
  getNotebook.mockResolvedValue({
    name: tab.name,
    type: tab.type,
    path: tab.path,
    content: notebookWith(outputs, others),
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

  it('says its kind in its box as every cell does, with its head inside the box', async () => {
    const { container } = renderNotebook(
      [],
      [
        { cell_type: 'code', id: 'py', source: 'x = 1', outputs: [], metadata: {} },
        { cell_type: 'raw', id: 'raw', source: '---', metadata: {} },
      ]
    );
    await screen.findByRole('button', { name: 'Run on analytics' });

    const boxes = [...container.querySelectorAll<HTMLElement>('.cellEditor')];
    expect(boxes.map((box) => box.dataset.kind)).toEqual(['sql', 'python', 'raw']);
    expect(boxes[0]).toHaveClass('has-head');
    expect(boxes[0].querySelector('.sqlCell-bar')).not.toBeNull();
    expect(screen.queryByText('SQL', { selector: 'span' })).toBeNull();
  });

  it('adds a SQL cell or a raw cell from the rail at the end, as well as code and markdown', async () => {
    const { container } = renderNotebook();
    await screen.findByRole('button', { name: 'Run on analytics' });
    const end = () => container.querySelector('.cell-insert.is-end') as HTMLElement;
    expect([...end().querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Code',
      'SQL',
      'Markdown',
      'Raw',
    ]);

    fireEvent.click(within(end()).getByRole('button', { name: 'SQL' }));
    await waitFor(() => expect(container.querySelectorAll('.cellEditor')).toHaveLength(2));
    // On the project's connection, into a frame name no other cell writes.
    const names = screen.getAllByRole('textbox', { name: 'Dataframe' }) as HTMLInputElement[];
    expect(names.map((input) => input.value)).toEqual(['df_orders', 'df_1']);
    expect(screen.getAllByRole('button', { name: 'Run on analytics' })).toHaveLength(2);

    fireEvent.click(within(end()).getByRole('button', { name: 'Raw' }));
    await waitFor(() =>
      expect(
        [...container.querySelectorAll<HTMLElement>('.cellEditor')].map((box) => box.dataset.kind)
      ).toEqual(['sql', 'sql', 'raw'])
    );
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

  it('says where its rows came from, and Load all counts them before it runs it without its limit', async () => {
    countRows.mockResolvedValue({ rows: 48_210 });
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
            row_bytes: 4096,
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
    const load = await screen.findByRole('button', { name: 'Load all · about 188 MB' });
    expect(countRows).toHaveBeenCalledWith('kernel-1', 'analytics', 'SELECT * FROM orders');
    expect(sockets[0].sent).toHaveLength(0);
    act(() => {
      fireEvent.click(load);
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
