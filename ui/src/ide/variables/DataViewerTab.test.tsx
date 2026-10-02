import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RowQuery } from '@/api';
import { notebookKernelMapAtom } from '@/store/kernels';
import DataViewerTab from './DataViewerTab';

const queryRows = vi.fn();
const profileVariable = vi.fn();
vi.mock('@/api', async () => {
  const client = await import('@/api/client');
  return {
    apiErrorMessage: client.apiErrorMessage,
    queryRows: (id: string, name: string, query: RowQuery) => queryRows(id, name, query),
    profileVariable: (id: string, name: string) => profileVariable(id, name),
  };
});

const tab = {
  type: 'data-viewer',
  path: 'data-viewer:train.ipynb::frame',
  name: 'frame',
  active: true,
  extension: null,
  load_required: false,
  kernelspec: '',
};

const columns = [
  { name: 'x', dtype: 'int64', kind: 'number' },
  { name: 'label', dtype: 'object', kind: 'text' },
];

function page(query: RowQuery) {
  const matched = (query.filters?.length ?? 0) > 0 ? 3 : 150;
  const count = Math.min(query.limit, matched - query.offset);
  return {
    columns,
    total_columns: 2,
    index: Array.from({ length: count }, (_, n) => String(query.offset + n)),
    rows: Array.from({ length: count }, (_, n) => {
      const at = query.offset + n;
      return [at, at === 0 ? { missing: 'NaN' } : `row ${at}`];
    }),
    total_rows: 150,
    matched_rows: matched,
    offset: query.offset,
    queryable: true,
  };
}

const profile = {
  columns: [
    {
      kind: 'number',
      count: 150,
      missing: 0,
      distinct: 150,
      min: 0,
      max: 149,
      mean: 74.5,
      std: 43.445,
      histogram: { counts: [30, 30, 30, 30, 30], edges: [0, 30, 60, 90, 120, 149] },
    },
    {
      kind: 'text',
      count: 150,
      missing: 15,
      distinct: 135,
      top: [{ value: 'row 1', count: 1 }],
    },
  ],
};

function renderTab() {
  const store = createStore();
  store.set(notebookKernelMapAtom, { 'train.ipynb': { id: 'kernel-1', name: 'python3' } });
  return render(
    <Provider store={store}>
      <DataViewerTab data={tab} />
    </Provider>
  );
}

const lastQuery = (): RowQuery => queryRows.mock.calls[queryRows.mock.calls.length - 1][2];

describe('DataViewerTab', () => {
  beforeEach(() => {
    queryRows.mockReset();
    queryRows.mockImplementation((_id, _name, query: RowQuery) => Promise.resolve(page(query)));
    profileVariable.mockReset();
    profileVariable.mockResolvedValue(profile);
  });

  it('shows the first page, each column’s dtype and its shape', async () => {
    const { container } = renderTab();

    expect(await screen.findByText('row 1')).toBeInTheDocument();
    expect(lastQuery()).toEqual({ offset: 0, limit: 100, filters: [] });
    expect(screen.getByText('int64')).toBeInTheDocument();
    expect(screen.getByText('150 rows × 2 columns')).toBeInTheDocument();
    expect(container.querySelector('td.is-missing')?.textContent).toBe('NaN');
    expect(screen.getByText('100 of 150 rows')).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelectorAll('.dataGrid-distribution rect')).toHaveLength(5)
    );
    expect(screen.getByText('10% missing')).toBeInTheDocument();
    expect(screen.getByText('135 distinct · row 1 1%')).toBeInTheDocument();
  });

  it('loads the next page under the first', async () => {
    renderTab();
    fireEvent.click(await screen.findByText('Load 100 more'));

    expect(await screen.findByText('row 149')).toBeInTheDocument();
    expect(lastQuery().offset).toBe(100);
    expect(screen.getByText('150 of 150 rows')).toBeInTheDocument();
  });

  it('sorts from a column’s menu, and describes the column there', async () => {
    const { container } = renderTab();
    await screen.findByText('row 1');

    fireEvent.click(screen.getByTitle('x (int64)'));
    const menu = screen.getByRole('menu', { name: 'Column x' });
    expect(within(menu).getByText('74.5')).toBeInTheDocument();
    fireEvent.click(within(menu).getByText('Sort descending'));

    await waitFor(() => expect(lastQuery().sort).toEqual({ column: 0, descending: true }));
    expect(container.querySelector('.dataGrid-column.is-sorted')).not.toBeNull();
  });

  it('filters, says how many rows match, and takes a filter away again', async () => {
    renderTab();
    await screen.findByText('row 1');

    fireEvent.click(screen.getByText('Add filter'));
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Comparison'), { target: { value: 'starts_with' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'row 1' } });
    fireEvent.click(screen.getByText('Apply'));

    await waitFor(() =>
      expect(lastQuery().filters).toEqual([{ column: 1, op: 'starts_with', value: 'row 1' }])
    );
    expect(await screen.findByText('3 of 150 rows × 2 columns')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 rows')).toBeInTheDocument();
    expect(screen.getByText('label starts with row 1')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Remove this filter'));
    await waitFor(() => expect(lastQuery().filters).toEqual([]));
  });

  it('opens the filter form on the column whose menu asked', async () => {
    renderTab();
    await screen.findByText('row 1');

    fireEvent.click(screen.getByTitle('label (object)'));
    fireEvent.click(screen.getByText('Filter this column…'));

    expect((screen.getByLabelText('Column') as HTMLSelectElement).value).toBe('1');
    expect((screen.getByLabelText('Comparison') as HTMLSelectElement).value).toBe('contains');
  });

  it('says so when the notebook’s kernel is not running', () => {
    render(
      <Provider store={createStore()}>
        <DataViewerTab data={tab} />
      </Provider>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('kernel of train.ipynb is not running');
    expect(queryRows).not.toHaveBeenCalled();
  });
});
