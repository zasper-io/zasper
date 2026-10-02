import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client';
import { finishedRunsAtom, notebookKernelMapAtom } from '@/store/kernels';
import { dockOpenAtom } from '@/store/languageServers';
import { fileTabsAtom } from '@/store/tabState';
import VariablesPanel from './VariablesPanel';

const listVariables = vi.fn();
vi.mock('@/api', async () => {
  const client = await import('@/api/client');
  return {
    ApiError: client.ApiError,
    apiErrorMessage: client.apiErrorMessage,
    listVariables: (id: string) => listVariables(id),
  };
});

const notebookTab = {
  type: 'notebook',
  path: 'train.ipynb',
  name: 'train.ipynb',
  active: true,
  extension: 'ipynb',
  load_required: false,
  kernelspec: 'python3',
};

const variables = [
  {
    name: 'frame',
    type: 'DataFrame',
    module: 'pandas.core.frame',
    kind: 'dataframe',
    shape: [250, 2],
    size: null,
    summary: 'x, y',
    viewable: true,
  },
  {
    name: 'answer',
    type: 'int',
    module: 'builtins',
    kind: 'other',
    shape: null,
    size: null,
    summary: '42',
    viewable: false,
  },
];

function renderPanel() {
  const store = createStore();
  store.set(fileTabsAtom, { [notebookTab.path]: notebookTab });
  store.set(notebookKernelMapAtom, { 'train.ipynb': { id: 'kernel-1', name: 'python3' } });
  store.set(dockOpenAtom, true);
  render(
    <Provider store={store}>
      <VariablesPanel />
    </Provider>
  );
  return store;
}

describe('VariablesPanel', () => {
  beforeEach(() => {
    listVariables.mockReset();
    listVariables.mockResolvedValue(variables);
  });

  it('lists the kernel’s variables with their type and size', async () => {
    renderPanel();

    expect(await screen.findByText('frame')).toBeInTheDocument();
    expect(listVariables).toHaveBeenCalledWith('kernel-1');
    expect(screen.getByText('DataFrame · 250 × 2 · x, y')).toBeInTheDocument();
    expect(screen.getByText('int · 42')).toBeInTheDocument();
  });

  it('opens a table-like variable in a tab, and leaves the rest as rows', async () => {
    const store = renderPanel();
    await screen.findByText('frame');

    expect(screen.getByText('answer').closest('button')).toBeNull();
    fireEvent.click(screen.getByTitle('Open frame as a table'));

    const opened = Object.values(store.get(fileTabsAtom)).find((tab) => tab.active);
    expect(opened?.type).toBe('data-viewer');
    expect(opened?.path).toBe('data-viewer:train.ipynb::frame');
  });

  it('reads the list again after a run finishes', async () => {
    const store = renderPanel();
    await screen.findByText('frame');

    act(() => store.set(finishedRunsAtom, { 'kernel-1': 1 }));

    await waitFor(() => expect(listVariables).toHaveBeenCalledTimes(2));
  });

  it('says the kernel is busy rather than failing', async () => {
    listVariables.mockRejectedValue(
      new ApiError('GET', '/api/kernels/kernel-1/variables', 504, '')
    );
    renderPanel();

    expect(await screen.findByText(/kernel is busy/)).toBeInTheDocument();
  });
});
