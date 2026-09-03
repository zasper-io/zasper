import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TabIndex from './TabIndex';
import { ApiError } from '@/api/client';
import { INotebookKernelMap, kernelsAtom, notebookKernelMapAtom } from '@/store/AppState';
import { fileTabsAtom, IfileTab, IfileTabDict } from '@/store/TabState';
import { SaveTab, unsavedTabsAtom } from '@/store/UnsavedState';

const deleteKernel = vi.fn();

vi.mock('@/api', async () => ({
  deleteKernel: (id: string) => deleteKernel(id),
  logApiError: () => () => {},
  // Not stubbed: what it reads out of a rejected save is what the prompt shows.
  apiErrorMessage: (await import('@/api/client')).apiErrorMessage,
}));

const launcher: IfileTab = {
  type: 'launcher',
  path: 'Launcher',
  name: 'Launcher',
  active: false,
  extension: 'txt',
  load_required: false,
  kernelspec: 'none',
};

const fileTab: IfileTab = {
  type: 'file',
  path: 'notes.txt',
  name: 'notes.txt',
  active: true,
  extension: 'txt',
  load_required: false,
  kernelspec: 'none',
};

const notebookTab: IfileTab = {
  type: 'notebook',
  path: 'demo.ipynb',
  name: 'demo.ipynb',
  active: true,
  extension: 'ipynb',
  load_required: false,
  kernelspec: 'python3',
};

const tabs: IfileTabDict = { Launcher: launcher, 'notes.txt': fileTab };

/** The tab bar with `notes.txt` open, unsaved or not. A jotai Provider per render: the atoms are global. */
function renderTabs(save?: SaveTab) {
  return render(
    <Provider
      initialValues={[
        [fileTabsAtom, { ...tabs }],
        [unsavedTabsAtom, save ? { 'notes.txt': save } : {}],
      ]}
    >
      <TabIndex />
    </Provider>
  );
}

/** The `notes.txt` tab, or null once it is closed. By role: the prompt names the file too. */
function tabForNotes(): HTMLElement | null {
  return screen.queryByRole('button', { name: /notes\.txt/ });
}

/** Clicks the close cross on the `notes.txt` tab. */
function clickClose(container: HTMLElement) {
  const crosses = container.querySelectorAll('.editor-button i');
  // Only the closable tabs have one, and Launcher is not closable.
  expect(crosses).toHaveLength(1);
  fireEvent.click(crosses[0]);
}

describe('TabIndex', () => {
  beforeEach(() => {
    deleteKernel.mockReset();
    deleteKernel.mockResolvedValue(undefined);
  });

  it('closes a tab whose contents match the file, with nothing to ask about', () => {
    const { container } = renderTabs();

    clickClose(container);

    expect(tabForNotes()).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('closing a tab with unsaved changes', () => {
    it('asks before closing it, naming the file', () => {
      const save = vi.fn<SaveTab>(() => Promise.resolve());
      const { container } = renderTabs(save);

      clickClose(container);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toHaveTextContent('notes.txt');
      expect(tabForNotes()).toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
    });

    it('leaves everything as it was when the answer is Cancel', () => {
      const save = vi.fn<SaveTab>(() => Promise.resolve());
      const { container } = renderTabs(save);
      clickClose(container);

      fireEvent.click(screen.getByText('Cancel'));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(tabForNotes()).toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
    });

    it('treats Escape as Cancel', () => {
      const { container } = renderTabs(() => Promise.resolve());
      clickClose(container);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(tabForNotes()).toBeInTheDocument();
    });

    it('closes without writing anything when the answer is Don’t Save', () => {
      const save = vi.fn<SaveTab>(() => Promise.resolve());
      const { container } = renderTabs(save);
      clickClose(container);

      fireEvent.click(screen.getByText("Don't Save"));

      expect(tabForNotes()).not.toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
    });

    it('saves through the editor and then closes when the answer is Save', async () => {
      const save = vi.fn<SaveTab>(() => Promise.resolve());
      const { container } = renderTabs(save);
      clickClose(container);

      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => expect(tabForNotes()).not.toBeInTheDocument());
      expect(save).toHaveBeenCalledOnce();
    });

    it('keeps the tab open and says why when the save fails', async () => {
      const save = vi.fn<SaveTab>(() =>
        Promise.reject(new ApiError('PUT', '/api/contents', 403, 'read-only file system'))
      );
      const { container } = renderTabs(save);
      clickClose(container);

      fireEvent.click(screen.getByText('Save'));

      expect(await screen.findByRole('alert')).toHaveTextContent('read-only file system');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(tabForNotes()).toBeInTheDocument();
    });
  });

  describe('closing a notebook tab', () => {
    /** The notebooks still holding a kernel, as the rest of the app reads them. */
    function Observer() {
      const notebookKernelMap = useAtomValue(notebookKernelMapAtom);
      return <span data-testid="kernels">{Object.keys(notebookKernelMap).join(',')}</span>;
    }

    function renderNotebookTab(notebookKernelMap: INotebookKernelMap) {
      return render(
        <Provider
          initialValues={[
            [fileTabsAtom, { Launcher: launcher, 'demo.ipynb': notebookTab }],
            [notebookKernelMapAtom, notebookKernelMap],
            [kernelsAtom, { 'kernel-1': { name: 'python3', id: 'kernel-1' } }],
            [unsavedTabsAtom, {}],
          ]}
        >
          <TabIndex />
          <Observer />
        </Provider>
      );
    }

    function tabForDemo(): HTMLElement | null {
      return screen.queryByRole('button', { name: /demo\.ipynb/ });
    }

    it('kills the kernel it was running and forgets it', () => {
      const { container } = renderNotebookTab({
        'demo.ipynb': { name: 'python3', id: 'kernel-1' },
      });

      clickClose(container);

      expect(deleteKernel).toHaveBeenCalledWith('kernel-1');
      expect(tabForDemo()).not.toBeInTheDocument();
      expect(screen.getByTestId('kernels')).toBeEmptyDOMElement();
    });

    // Closed while the session was still starting, or after starting one failed.
    it('closes cleanly when it never got a kernel', () => {
      const { container } = renderNotebookTab({});

      clickClose(container);

      expect(tabForDemo()).not.toBeInTheDocument();
      expect(deleteKernel).not.toHaveBeenCalled();
    });
  });
});
