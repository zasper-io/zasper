import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KernelResources } from '@/api';
import { commandsAtom } from '@/commands/registry';
import { notebookKernelMapAtom } from '@/store/kernels';
import KernelResourceStatus from './KernelResourceStatus';

const GIB = 1024 ** 3;
const getKernelResources = vi.fn();

vi.mock('@/api', () => ({ getKernelResources: () => getKernelResources() }));

const training: KernelResources = {
  memory: { used: 41.6 * GIB, total: 62.8 * GIB, limit: 'machine' },
  gpus: [
    {
      index: 0,
      name: 'NVIDIA A10G',
      utilization: 87,
      memory_used: 18.2 * GIB,
      memory_total: 24 * GIB,
      unattributed: 0,
    },
  ],
  kernels: {
    'kernel-1': { memory: 5.1 * GIB, processes: 5, gpus: [{ index: 0, memory: 17.9 * GIB }] },
  },
};

function renderItem(bound = true) {
  const store = createStore();
  if (bound) {
    store.set(notebookKernelMapAtom, { 'train.ipynb': { name: 'python3', id: 'kernel-1' } });
  }
  const restart = vi.fn();
  store.set(commandsAtom, {
    'notebook:restart-kernel': {
      id: 'notebook:restart-kernel',
      label: 'Restart Kernel',
      category: 'Kernel',
      execute: restart,
    },
  } as never);
  render(
    <Provider store={store}>
      <KernelResourceStatus path="train.ipynb" />
    </Provider>
  );
  return { restart };
}

describe('KernelResourceStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getKernelResources.mockResolvedValue(training);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the kernel’s memory and the GPU memory it holds', async () => {
    renderItem();

    const item = await screen.findByRole('button', {
      name: 'Kernel memory 5.1 GB, GPU 17.9 GB · 87%',
    });
    expect(item).toHaveTextContent('5.1 GB');
    expect(item).toHaveTextContent('17.9 GB · 87%');
  });

  it('opens a menu with what each figure is measured against', async () => {
    const { restart } = renderItem();
    fireEvent.click(await screen.findByRole('button', { name: /Kernel memory/ }));

    expect(screen.getByText('The kernel and 4 processes it started')).toBeInTheDocument();
    expect(screen.getByText('41.6 of 62.8 GB')).toBeInTheDocument();
    expect(screen.getByText('GPU 0 · A10G')).toBeInTheDocument();
    expect(
      screen.getByText('18.2 of 24 GB in use · 307 MB by other processes')
    ).toBeInTheDocument();
    expect(screen.getByText('The whole GPU, not only this kernel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Restart kernel' }));
    expect(restart).toHaveBeenCalled();
  });

  it('asks nothing and shows nothing for a notebook without a kernel', async () => {
    renderItem(false);
    await act(async () => {});

    expect(getKernelResources).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks again every two seconds', async () => {
    vi.useFakeTimers();
    renderItem();
    await act(async () => {});
    expect(getKernelResources).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(getKernelResources).toHaveBeenCalledTimes(2);
  });

  it('takes its figures down when the server stops answering', async () => {
    renderItem();
    await screen.findByRole('button', { name: /Kernel memory/ });

    getKernelResources.mockRejectedValue(new Error('gone'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
  });
});
