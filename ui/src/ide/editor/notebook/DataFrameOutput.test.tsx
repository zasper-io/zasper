import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotebookOutput, RowQuery } from '@/api';
import { ApiError } from '@/api/client';
import { fileTabsAtom } from '@/store/tabState';
import { OutputBundles } from './CellOutput';

const queryRows = vi.fn();
const profileVariable = vi.fn();
const exportRows = vi.fn();
vi.mock('@/api', async () => {
  const client = await import('@/api/client');
  const kernels = await import('@/api/kernels');
  return {
    ApiError: client.ApiError,
    apiErrorMessage: client.apiErrorMessage,
    TABLE_MIME: kernels.TABLE_MIME,
    queryRows: (id: string, name: string, query: RowQuery) => queryRows(id, name, query),
    profileVariable: (id: string, name: string) => profileVariable(id, name),
    exportRows: (id: string, name: string, query: RowQuery) => exportRows(id, name, query),
  };
});

const output: NotebookOutput = {
  output_type: 'execute_result',
  execution_count: 9,
  metadata: {},
  data: {
    'text/html': '<table class="dataframe"><tr><td>pandas own table</td></tr></table>',
    'text/plain': 'x\n0 0',
    'application/vnd.zasper.dataframe+json': {
      id: 'a'.repeat(32),
      kind: 'dataframe',
      rows: 30,
      columns: 2,
    },
  },
};

function page(query: RowQuery) {
  const matched = (query.filters?.length ?? 0) > 0 ? 4 : 30;
  const count = Math.max(0, Math.min(query.limit, matched - query.offset));
  return {
    columns: [
      { name: 'x', dtype: 'int64', kind: 'number' },
      { name: 'label', dtype: 'object', kind: 'text' },
    ],
    total_columns: 2,
    index: Array.from({ length: count }, (_, n) => String(query.offset + n)),
    rows: Array.from({ length: count }, (_, n) => [query.offset + n, `row ${query.offset + n}`]),
    total_rows: 30,
    matched_rows: matched,
    offset: query.offset,
    queryable: true,
  };
}

const lastQuery = (): RowQuery => queryRows.mock.calls[queryRows.mock.calls.length - 1][2];

function renderOutput(kernelId: string | undefined) {
  const store = createStore();
  const rendered = render(
    <Provider store={store}>
      <OutputBundles
        outputs={[output]}
        widgets={null}
        tables={{ kernelId, notebookPath: 'sales.ipynb', executionCount: 9 }}
      />
    </Provider>
  );
  return { store, ...rendered };
}

describe('a DataFrame in a cell', () => {
  beforeEach(() => {
    queryRows.mockReset();
    queryRows.mockImplementation((_id, _name, query: RowQuery) => Promise.resolve(page(query)));
    profileVariable.mockReset();
    profileVariable.mockResolvedValue({ columns: [] });
    exportRows.mockReset();
  });

  it('is a grid of the frame the cell printed, ten rows a page', async () => {
    renderOutput('kernel-1');

    expect(await screen.findByText('row 9')).toBeInTheDocument();
    expect(queryRows).toHaveBeenCalledWith('kernel-1', '@' + 'a'.repeat(32), {
      offset: 0,
      limit: 10,
      filters: [],
    });
    expect(screen.getByText('30 rows × 2 columns')).toBeInTheDocument();
    expect(screen.getByText('Rows 1–10 of 30')).toBeInTheDocument();
    expect(screen.queryByText('pandas own table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Next page'));
    expect(await screen.findByText('row 19')).toBeInTheDocument();
    expect(lastQuery().offset).toBe(10);

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ offset: 0, limit: 25 }));
  });

  it('filters from its bar, and goes back to the first page', async () => {
    renderOutput('kernel-1');
    await screen.findByText('row 9');
    fireEvent.click(screen.getByLabelText('Next page'));
    await screen.findByText('row 19');

    fireEvent.click(screen.getByLabelText('Filter rows'));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'row 1' } });
    fireEvent.click(screen.getByText('Apply'));

    await waitFor(() =>
      expect(lastQuery()).toMatchObject({
        offset: 0,
        filters: [{ column: 0, op: 'eq', value: 'row 1' }],
      })
    );
    expect(await screen.findByText('4 of 30 rows × 2 columns')).toBeInTheDocument();
    expect(screen.getByText('x = row 1')).toBeInTheDocument();
  });

  it('opens in a tab named for its cell, with its filters', async () => {
    const { store } = renderOutput('kernel-1');
    await screen.findByText('row 9');

    fireEvent.click(screen.getByLabelText('Open in a tab'));

    const opened = Object.values(store.get(fileTabsAtom)).find((tab) => tab.active);
    expect(opened).toMatchObject({
      name: 'Out[9]',
      type: 'data-viewer',
      path: `data-viewer:sales.ipynb::@${'a'.repeat(32)}`,
    });
  });

  it('copies the rows its filters leave as CSV', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    exportRows.mockResolvedValue(',x\n0,0\n');
    renderOutput('kernel-1');
    await screen.findByText('row 9');

    fireEvent.click(screen.getByLabelText('Copy as CSV'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(',x\n0,0\n'));
    expect(exportRows.mock.calls[0][2]).toMatchObject({ offset: 0, limit: 100_000, filters: [] });
  });

  it('is pandas’ table again once the kernel has let the frame go', async () => {
    queryRows.mockRejectedValue(new ApiError('POST', '/rows', 410, 'gone'));
    renderOutput('kernel-1');

    expect(await screen.findByText('pandas own table')).toBeInTheDocument();
    expect(screen.getByText(/no longer in the kernel/)).toBeInTheDocument();
  });

  it('is pandas’ table, asking nothing, when there is no kernel', () => {
    renderOutput(undefined);

    expect(screen.getByText('pandas own table')).toBeInTheDocument();
    expect(
      screen.getByText('30 rows. Run the cell to page, sort and filter them.')
    ).toBeInTheDocument();
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('is pandas’ table in an export, which passes no kernel at all', () => {
    render(<OutputBundles outputs={[output]} widgets={null} />);

    expect(screen.getByText('pandas own table')).toBeInTheDocument();
    expect(queryRows).not.toHaveBeenCalled();
    act(() => undefined);
  });
});
