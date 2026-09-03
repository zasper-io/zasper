import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kernelsAtom, notebookKernelMapAtom } from './AppState';
import { useTabActions } from './TabActions';
import { fileTabsAtom, IfileTab, IfileTabDict } from './TabState';

const deleteKernel = vi.fn();

vi.mock('@/api', () => ({
  deleteKernel: (id: string) => deleteKernel(id),
  logApiError: () => () => {},
}));

function tab(path: string, type = 'file'): IfileTab {
  return {
    type,
    path,
    name: path.split('/').pop() ?? path,
    active: false,
    extension: 'txt',
    load_required: false,
    kernelspec: 'none',
  };
}

const tabs: IfileTabDict = {
  Launcher: { ...tab('Launcher', 'launcher'), name: 'Launcher' },
  'notes.txt': tab('notes.txt'),
  'src/main.py': tab('src/main.py'),
  'src/demo.ipynb': tab('src/demo.ipynb', 'notebook'),
};

/** The open tabs, the name each shows, and which notebooks still hold a kernel. */
function Harness() {
  const { closeDeleted, renameTab } = useTabActions();
  const openTabs = useAtomValue(fileTabsAtom);
  const notebookKernelMap = useAtomValue(notebookKernelMapAtom);

  return (
    <div>
      <span data-testid="tabs">{Object.keys(openTabs).join(',')}</span>
      <span data-testid="names">
        {Object.values(openTabs)
          .map((openTab) => openTab.name)
          .join(',')}
      </span>
      <span data-testid="kernels">{Object.keys(notebookKernelMap).join(',')}</span>
      <button type="button" onClick={() => closeDeleted('src')}>
        delete src
      </button>
      <button type="button" onClick={() => renameTab('src', 'lib')}>
        rename src
      </button>
      <button type="button" onClick={() => renameTab('notes.txt', 'todo.txt')}>
        rename notes
      </button>
    </div>
  );
}

function renderHarness() {
  return render(
    <Provider
      initialValues={[
        [fileTabsAtom, { ...tabs }],
        [notebookKernelMapAtom, { 'src/demo.ipynb': { name: 'python3', id: 'kernel-1' } }],
        [kernelsAtom, { 'kernel-1': { name: 'python3', id: 'kernel-1' } }],
      ]}
    >
      <Harness />
    </Provider>
  );
}

function text(testId: string): string {
  return screen.getByTestId(testId).textContent ?? '';
}

describe('useTabActions', () => {
  beforeEach(() => {
    deleteKernel.mockReset();
    deleteKernel.mockResolvedValue(undefined);
  });

  it('closes every tab inside a deleted folder, and kills their kernels', () => {
    renderHarness();

    fireEvent.click(screen.getByText('delete src'));

    expect(text('tabs')).toBe('Launcher,notes.txt');
    expect(deleteKernel).toHaveBeenCalledWith('kernel-1');
    expect(text('kernels')).toBe('');
  });

  it('moves the tabs inside a renamed folder, keeping them where they were', () => {
    renderHarness();

    fireEvent.click(screen.getByText('rename src'));

    expect(text('tabs')).toBe('Launcher,notes.txt,lib/main.py,lib/demo.ipynb');
    // The kernel belongs to the notebook, not to the path it had.
    expect(text('kernels')).toBe('lib/demo.ipynb');
  });

  it('relabels a renamed tab', () => {
    renderHarness();

    fireEvent.click(screen.getByText('rename notes'));

    expect(text('tabs')).toBe('Launcher,todo.txt,src/main.py,src/demo.ipynb');
    // The tab strip shows `name`, so a tab whose path moved but whose name did not is a tab
    // labelled with a file that no longer exists.
    expect(text('names')).toBe('Launcher,todo.txt,main.py,demo.ipynb');
  });
});
