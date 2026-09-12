import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notebookKernelMapAtom } from './AppState';
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

/** A tab restored from a previous session: on screen, but its content has never been read. */
function restored(path: string, type = 'file'): IfileTab {
  return { ...tab(path, type), unloaded: true };
}

/** The open tabs, the name each shows, and which notebooks still hold a kernel. */
function Harness() {
  const { activateTab, closeTab, closeDeleted, renameTab, openDiff, openTab } = useTabActions();
  const openTabs = useAtomValue(fileTabsAtom);
  const notebookKernelMap = useAtomValue(notebookKernelMapAtom);

  return (
    <div>
      <span data-testid="tabs">{Object.keys(openTabs).join(',')}</span>
      <span data-testid="targets">
        {Object.values(openTabs)
          .filter((openTab) => openTab.diff !== undefined)
          .map((openTab) => JSON.stringify(openTab.diff))
          .join(',')}
      </span>
      <span data-testid="extensions">
        {Object.values(openTabs)
          .filter((openTab) => openTab.diff !== undefined)
          .map((openTab) => String(openTab.extension))
          .join(',')}
      </span>
      <span data-testid="names">
        {Object.values(openTabs)
          .map((openTab) => openTab.name)
          .join(',')}
      </span>
      <span data-testid="kernels">{Object.keys(notebookKernelMap).join(',')}</span>
      <span data-testid="active">
        {Object.keys(openTabs)
          .filter((key) => openTabs[key].active)
          .join(',')}
      </span>
      {/* Which tabs are reading themselves, and which have never been read. */}
      <span data-testid="loading">
        {Object.keys(openTabs)
          .filter((key) => openTabs[key].load_required)
          .join(',')}
      </span>
      <span data-testid="unloaded">
        {Object.keys(openTabs)
          .filter((key) => openTabs[key].unloaded === true)
          .join(',')}
      </span>
      <button type="button" onClick={() => activateTab('notes.txt')}>
        activate notes
      </button>
      <button type="button" onClick={() => activateTab('src/main.py')}>
        activate main
      </button>
      <button type="button" onClick={() => activateTab('gone.txt')}>
        activate a tab that is not open
      </button>
      <button
        type="button"
        onClick={() => openTab({ name: 'notes.txt', path: 'notes.txt', type: 'file' })}
      >
        open notes
      </button>
      <button type="button" onClick={() => closeTab('src/demo.ipynb')}>
        close demo
      </button>
      <button type="button" onClick={() => closeTab('notes.txt')}>
        close notes
      </button>
      <button type="button" onClick={() => closeDeleted('src')}>
        delete src
      </button>
      <button type="button" onClick={() => closeDeleted('src/demo.ipynb')}>
        delete demo
      </button>
      <button type="button" onClick={() => renameTab('src', 'lib')}>
        rename src
      </button>
      <button type="button" onClick={() => renameTab('notes.txt', 'todo.txt')}>
        rename notes
      </button>
      <button type="button" onClick={() => openDiff({ path: 'notes.txt' })}>
        diff notes
      </button>
      <button type="button" onClick={() => openDiff({ path: 'notes.txt', staged: true })}>
        diff notes staged
      </button>
      <button
        type="button"
        onClick={() => openDiff({ path: 'notes.txt', ref: 'abc1234def5678', from: 'old.txt' })}
      >
        diff notes at a commit
      </button>
    </div>
  );
}

function renderHarness(initialTabs: IfileTabDict = tabs) {
  return render(
    <Provider
      initialValues={[
        [fileTabsAtom, { ...initialTabs }],
        [notebookKernelMapAtom, { 'src/demo.ipynb': { name: 'python3', id: 'kernel-1' } }],
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

  /*
   * What JupyterLab does, and the reason the binding is kept: the notebook can be reopened, and opening
   * it asks the server what is already running that path.
   */
  it('closes a notebook tab without touching its kernel', () => {
    renderHarness();

    fireEvent.click(screen.getByText('close demo'));

    expect(text('tabs')).toBe('Launcher,notes.txt,src/main.py');
    expect(deleteKernel).not.toHaveBeenCalled();
    expect(text('kernels')).toBe('src/demo.ipynb');
  });

  // A kernel outlives its tab, so the delete cannot look at the tabs to find it.
  it('kills a deleted notebook’s kernel even though its tab was closed first', () => {
    renderHarness();

    fireEvent.click(screen.getByText('close demo'));
    fireEvent.click(screen.getByText('delete demo'));

    expect(deleteKernel).toHaveBeenCalledWith('kernel-1');
    expect(text('kernels')).toBe('');
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

  /*
   * A diff opens beside the editor for the same file rather than instead of it.
   *
   * Tabs are keyed by path, so a diff keyed by the file's own path would be that file's editor: the
   * click would bring the editor forward and nothing else would happen.
   */
  it('opens a diff without disturbing the editor for the same file', () => {
    renderHarness();

    fireEvent.click(screen.getByText('diff notes'));

    expect(text('tabs')).toBe(
      'Launcher,notes.txt,src/main.py,src/demo.ipynb,diff:worktree:notes.txt'
    );
    expect(text('names')).toContain('notes.txt (diff)');
    expect(text('targets')).toBe('{"path":"notes.txt"}');
    // The file's extension, not the tab name's: the name ends in `(diff)`, and the status bar prints
    // whatever this says the tab holds.
    expect(text('extensions')).toBe('txt');
  });

  // Two comparisons of one file are two pairs of documents, so they are two tabs.
  it('keeps the staged and unstaged diffs of one file apart', () => {
    renderHarness();

    fireEvent.click(screen.getByText('diff notes'));
    fireEvent.click(screen.getByText('diff notes staged'));

    expect(text('tabs')).toContain('diff:worktree:notes.txt,diff:staged:notes.txt');
    expect(text('names')).toContain('notes.txt (diff),notes.txt (staged)');
  });

  it('names a commit diff after the commit, and carries the name the file had', () => {
    renderHarness();

    fireEvent.click(screen.getByText('diff notes at a commit'));

    // The short hash, because the whole one is longer than the tab it would be written in.
    expect(text('names')).toContain('notes.txt (abc1234)');
    expect(text('targets')).toBe('{"path":"notes.txt","ref":"abc1234def5678","from":"old.txt"}');
  });

  it('relabels a renamed tab', () => {
    renderHarness();

    fireEvent.click(screen.getByText('rename notes'));

    expect(text('tabs')).toBe('Launcher,todo.txt,src/main.py,src/demo.ipynb');
    // The tab strip shows `name`, so a tab whose path moved but whose name did not is a tab
    // labelled with a file that no longer exists.
    expect(text('names')).toBe('Launcher,todo.txt,main.py,demo.ipynb');
  });

  // Every active tab's content is shown, so a second one in front puts two on screen at once.
  it('leaves the tab in front alone when a tab behind it is closed', () => {
    renderHarness({ ...tabs, 'notes.txt': { ...tabs['notes.txt'], active: true } });

    fireEvent.click(screen.getByText('close demo'));

    expect(text('active')).toBe('notes.txt');
  });

  it('brings the Launcher forward when the tab in front is closed', () => {
    renderHarness({ ...tabs, 'notes.txt': { ...tabs['notes.txt'], active: true } });

    fireEvent.click(screen.getByText('close notes'));

    expect(text('active')).toBe('Launcher');
  });

  /*
   * `load_required` re-reads the file from disk, so asking for it on a tab that has already been read
   * would throw away whatever the reader had typed into it. Switching tabs is not a refresh.
   */
  it('raises a tab that has already loaded without reading it again', () => {
    renderHarness();

    fireEvent.click(screen.getByText('activate notes'));

    expect(text('active')).toBe('notes.txt');
    expect(text('loading')).toBe('');
  });

  // The point of the whole restore: the strip comes back, and a tab reads itself when it is reached.
  it('reads a restored tab the first time it is brought to the front', () => {
    renderHarness({ ...tabs, 'notes.txt': restored('notes.txt') });

    fireEvent.click(screen.getByText('activate notes'));

    expect(text('active')).toBe('notes.txt');
    expect(text('loading')).toBe('notes.txt');
    expect(text('unloaded')).toBe('');
  });

  it('does not read a restored tab again on the next visit', () => {
    renderHarness({ ...tabs, 'notes.txt': restored('notes.txt') });

    fireEvent.click(screen.getByText('activate notes'));
    fireEvent.click(screen.getByText('activate main'));
    fireEvent.click(screen.getByText('activate notes'));

    expect(text('active')).toBe('notes.txt');
    expect(text('loading')).toBe('');
  });

  // The file browser's way back to a restored tab, which goes through openTab rather than activateTab.
  it('reads a restored tab opened from somewhere else', () => {
    renderHarness({ ...tabs, 'notes.txt': restored('notes.txt') });

    fireEvent.click(screen.getByText('open notes'));

    expect(text('tabs')).toBe('Launcher,notes.txt,src/main.py,src/demo.ipynb');
    expect(text('loading')).toBe('notes.txt');
  });

  // Every caller names a tab it is rendering; a path that is not open used to be invented as a tab.
  it('ignores a request to activate a tab that is not open', () => {
    renderHarness({ ...tabs, 'notes.txt': { ...tabs['notes.txt'], active: true } });

    fireEvent.click(screen.getByText('activate a tab that is not open'));

    // No tab invented, and the one in front stays there.
    expect(text('tabs')).toBe('Launcher,notes.txt,src/main.py,src/demo.ipynb');
    expect(text('active')).toBe('notes.txt');
  });
});
