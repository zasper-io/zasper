import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RowQuery } from '@/api';
import { notebookKernelMapAtom } from '@/store/kernels';
import DataViewerTab from './DataViewerTab';

const queryRows = vi.fn();
const profileVariable = vi.fn();
const exportRows = vi.fn();
vi.mock('@/api', async () => {
  const client = await import('@/api/client');
  return {
    apiErrorMessage: client.apiErrorMessage,
    queryRows: (id: string, name: string, query: RowQuery) => queryRows(id, name, query),
    profileVariable: (id: string, name: string) => profileVariable(id, name),
    exportRows: (id: string, name: string, query: RowQuery) => exportRows(id, name, query),
    ApiError: client.ApiError,
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
    expect(screen.getByText('150 rows')).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelectorAll('.dataGrid-distribution rect')).toHaveLength(5)
    );
    expect(screen.getByText('10% missing')).toBeInTheDocument();
    expect(screen.getByText('135 distinct · row 1 1%')).toBeInTheDocument();
  });

  it('draws only the rows near the view, and reads the next page as it scrolls there', async () => {
    const { container } = renderTab();
    await screen.findByText('row 1');

    // A 600px view of 28px rows, and twenty more each way: row 60 has been read but is not drawn.
    expect(screen.queryByText('row 60')).not.toBeInTheDocument();
    expect(queryRows).toHaveBeenCalledTimes(1);

    const scroller = container.querySelector('.dataGrid-scroll') as HTMLElement;
    Object.defineProperty(scroller, 'scrollTop', { value: 3000, configurable: true });
    fireEvent.scroll(scroller);

    expect(await screen.findByText('row 120')).toBeInTheDocument();
    expect(lastQuery().offset).toBe(100);
    expect(screen.queryByText('row 1')).not.toBeInTheDocument();
  });

  it('copies the cell the reader picked, as the kernel sent it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = renderTab();
    fireEvent.click(await screen.findByText('row 3'));

    const scroller = container.querySelector('.dataGrid-scroll') as HTMLElement;
    fireEvent.keyDown(scroller, { key: 'ArrowRight' });
    fireEvent.keyDown(scroller, { key: 'ArrowUp' });
    expect(container.querySelector('td.is-selected')?.textContent).toBe('row 2');

    fireEvent.keyDown(scroller, { key: 'c', metaKey: true });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('row 2'));
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
    expect(screen.getByText('3 rows')).toBeInTheDocument();
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

  it('hides a column from its menu, and shows it again from the bar', async () => {
    renderTab();
    await screen.findByText('row 1');

    fireEvent.click(screen.getByTitle('x (int64)'));
    fireEvent.click(screen.getByText('Hide column'));

    expect(screen.queryByTitle('x (int64)')).not.toBeInTheDocument();
    expect(screen.queryByText('99')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Show 1 hidden'));
    expect(screen.getByTitle('x (int64)')).toBeInTheDocument();
  });

  it('moves a column, and its cells go with it', async () => {
    const { container } = renderTab();
    await screen.findByText('row 1');
    const firstHeader = () => container.querySelector('thead .dataGrid-columnName')?.textContent;
    const secondRow = () =>
      [...container.querySelectorAll('tbody tr')][1].querySelectorAll('td')[0].textContent;
    expect(firstHeader()).toBe('x');

    fireEvent.click(screen.getByTitle('x (int64)'));
    fireEvent.click(screen.getByText('Move right'));

    expect(firstHeader()).toBe('label');
    expect(secondRow()).toBe('row 1');
  });

  it('resizes a column by its edge', async () => {
    renderTab();
    await screen.findByText('row 1');

    // jsdom has no PointerEvent, and the bare Event it falls back to carries no clientX.
    const pointer = (type: string, clientX: number) =>
      new MouseEvent(type, { bubbles: true, clientX });
    fireEvent(screen.getByLabelText('Resize label'), pointer('pointerdown', 100));
    fireEvent(window, pointer('pointermove', 220));
    fireEvent(window, pointer('pointerup', 220));

    const header = screen.getByTitle('label (object)').closest('th') as HTMLElement;
    expect(header.style.width).toBe('120px');
  });

  it('exports the columns as they are arranged', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    exportRows.mockResolvedValue(',label\n0,row 0\n');
    renderTab();
    await screen.findByText('row 1');

    fireEvent.click(screen.getByTitle('x (int64)'));
    fireEvent.click(screen.getByText('Hide column'));
    fireEvent.click(screen.getByLabelText('Copy as CSV'));

    await waitFor(() => expect(exportRows).toHaveBeenCalled());
    expect(exportRows.mock.calls[0][2].columns).toEqual([1]);
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
