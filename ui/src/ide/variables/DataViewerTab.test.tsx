import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notebookKernelMapAtom } from '@/store/kernels';
import DataViewerTab from './DataViewerTab';

const previewVariable = vi.fn();
vi.mock('@/api', async () => {
  const client = await import('@/api/client');
  return {
    apiErrorMessage: client.apiErrorMessage,
    previewVariable: (id: string, name: string, offset: number, limit: number) =>
      previewVariable(id, name, offset, limit),
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

const page = (offset: number, count: number) => ({
  columns: [
    { name: 'x', dtype: 'int64' },
    { name: 'label', dtype: 'object' },
  ],
  total_columns: 2,
  index: Array.from({ length: count }, (_, n) => String(offset + n)),
  rows: Array.from({ length: count }, (_, n) => [
    offset + n,
    n === 0 ? { missing: 'NaN' } : `row ${offset + n}`,
  ]),
  total_rows: 150,
  offset,
});

function renderTab() {
  const store = createStore();
  store.set(notebookKernelMapAtom, { 'train.ipynb': { id: 'kernel-1', name: 'python3' } });
  return render(
    <Provider store={store}>
      <DataViewerTab data={tab} />
    </Provider>
  );
}

describe('DataViewerTab', () => {
  beforeEach(() => {
    previewVariable.mockReset();
    previewVariable.mockImplementation((_id, _name, offset: number) =>
      Promise.resolve(page(offset, offset === 0 ? 100 : 50))
    );
  });

  it('shows the first page with each column’s dtype', async () => {
    const { container } = renderTab();

    expect(await screen.findByText('row 1')).toBeInTheDocument();
    expect(previewVariable).toHaveBeenCalledWith('kernel-1', 'frame', 0, 100);
    expect(screen.getByText('int64')).toBeInTheDocument();
    expect(screen.getByText('150 × 2')).toBeInTheDocument();
    expect(container.querySelector('td.is-missing')?.textContent).toBe('NaN');
    expect(screen.getByText('Showing 100 of 150 rows')).toBeInTheDocument();
  });

  it('loads the next page under the first', async () => {
    renderTab();
    fireEvent.click(await screen.findByText('Load 100 more'));

    expect(await screen.findByText('row 149')).toBeInTheDocument();
    expect(previewVariable).toHaveBeenLastCalledWith('kernel-1', 'frame', 100, 100);
    expect(screen.getByText('Showing 150 of 150 rows')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Load 100 more')).not.toBeInTheDocument());
  });

  it('says so when the notebook’s kernel is not running', () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <DataViewerTab data={tab} />
      </Provider>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('kernel of train.ipynb is not running');
    expect(previewVariable).not.toHaveBeenCalled();
  });
});
