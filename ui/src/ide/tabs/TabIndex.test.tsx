import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { Provider } from '@/testing/Provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TabIndex from './TabIndex';
import { useRunCommand } from '@/commands/registry';
import { useCommandKeymap } from '@/commands/useCommandKeymap';
import { ApiError } from '@/api/client';
import { NotebookKernelMap, notebookKernelMapAtom } from '@/store/kernels';
import { fileTabsAtom, FileTab, FileTabDict } from '@/store/tabState';
import { SaveTab, unsavedTabsAtom } from '@/store/unsavedState';

const deleteKernel = vi.fn();

vi.mock('@/api', async () => ({
  deleteKernel: (id: string) => deleteKernel(id),
  logApiError: () => () => {},
  // Not stubbed: what it reads out of a rejected save is what the prompt shows.
  apiErrorMessage: (await import('@/api/client')).apiErrorMessage,
}));

const launcher: FileTab = {
  type: 'launcher',
  path: 'Launcher',
  name: 'Launcher',
  active: false,
  extension: 'txt',
  load_required: false,
  kernelspec: 'none',
};

const fileTab: FileTab = {
  type: 'file',
  path: 'notes.txt',
  name: 'notes.txt',
  active: true,
  extension: 'txt',
  load_required: false,
  kernelspec: 'none',
};

const notebookTab: FileTab = {
  type: 'notebook',
  path: 'demo.ipynb',
  name: 'demo.ipynb',
  active: true,
  extension: 'ipynb',
  load_required: false,
  kernelspec: 'python3',
};

const tabs: FileTabDict = { Launcher: launcher, 'notes.txt': fileTab };

/** The tab bar with `notes.txt` open, unsaved or not. A jotai Provider per render: the atoms are global. */
function renderTabs(save?: SaveTab) {
  return render(
    <Provider
      initialValues={[
        [fileTabsAtom, { ...tabs }],
        [unsavedTabsAtom, save ? { 'notes.txt': save } : {}],
      ]}
    >
      <TabIndex onShowFileBrowser={() => {}} />
    </Provider>
  );
}

const scriptTab: FileTab = { ...fileTab, path: 'prepare.py', name: 'prepare.py', active: false };

const settingsTab: FileTab = {
  ...fileTab,
  type: 'settings',
  path: 'Settings',
  name: 'Settings',
  active: false,
};

function Keys() {
  useCommandKeymap();
  return null;
}

function Runner({ onReady }: { onReady: (run: (id: string) => boolean) => void }) {
  onReady(useRunCommand());
  return null;
}

/** Launcher, `notes.txt` in front, `prepare.py` and a terminal, with the keyboard dispatcher mounted. */
function renderStrip(unsaved: Record<string, SaveTab> = {}, extra?: React.ReactNode) {
  return render(
    <Provider
      initialValues={[
        [
          fileTabsAtom,
          {
            Launcher: launcher,
            'notes.txt': fileTab,
            'prepare.py': scriptTab,
            Settings: settingsTab,
          },
        ],
        [unsavedTabsAtom, unsaved],
      ]}
    >
      <TabIndex onShowFileBrowser={() => {}} />
      <Keys />
      {extra}
    </Provider>
  );
}

function openMenu(tabName: RegExp) {
  fireEvent.contextMenu(screen.getByRole('button', { name: tabName }));
}

function menuRow(label: string): HTMLElement {
  return screen.getByRole('menuitem', { name: new RegExp(`^${label}`) });
}

function tabNames(): string[] {
  return Array.from(document.querySelectorAll('.tabName')).map((name) => name.textContent ?? '');
}

/** The `notes.txt` tab, or null once it is closed. By role: the prompt names the file too. */
function tabForNotes(): HTMLElement | null {
  return screen.queryByRole('button', { name: /notes\.txt/ });
}

/** Clicks the close cross on the `notes.txt` tab. */
function clickClose(container: HTMLElement) {
  const crosses = container.querySelectorAll('.tab-close');
  // Only the closable tabs have one, and Launcher is not closable.
  expect(crosses).toHaveLength(1);
  fireEvent.click(crosses[0]);
}

describe('TabIndex', () => {
  beforeEach(() => {
    deleteKernel.mockReset();
    deleteKernel.mockResolvedValue(undefined);
  });

  describe('the tab menu', () => {
    it('lists every close, then the path rows for a file', () => {
      renderStrip();
      openMenu(/prepare\.py/);

      const labels = screen
        .getAllByRole('menuitem')
        .map((row) => row.querySelector('.panel-row-label')?.textContent);
      expect(labels).toEqual([
        'Close',
        'Close Others',
        'Close to the Right',
        'Close to the Left',
        'Close Saved',
        'Close All',
        'Copy Path',
        'Reveal in File Explorer',
      ]);
      expect(menuRow('Close All').querySelector('.panel-row-keys')).not.toBeNull();
      expect(screen.getAllByRole('separator')).toHaveLength(1);
    });

    it('leaves the path rows off a tab with no file, and greys what there is nothing to close for', () => {
      renderStrip();
      openMenu(/Settings/);

      expect(screen.queryByRole('menuitem', { name: /Copy Path/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('separator')).not.toBeInTheDocument();
      expect(menuRow('Close to the Right')).toBeDisabled();
      expect(menuRow('Close to the Left')).toBeEnabled();
    });

    it('closes the others, bringing the tab forward when the one in front went', () => {
      renderStrip();
      openMenu(/prepare\.py/);

      fireEvent.click(menuRow('Close Others'));

      expect(tabNames()).toEqual(['Launcher', 'prepare.py']);
      expect(screen.getByRole('button', { name: /prepare\.py/ })).toHaveClass('is-active');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('asks once about every unsaved tab, and closes the saved ones straight away', () => {
      const save = vi.fn<SaveTab>(() => Promise.resolve());
      renderStrip({ 'notes.txt': save, 'prepare.py': save });
      openMenu(/notes\.txt/);

      fireEvent.click(menuRow('Close All'));

      expect(tabNames()).toEqual(['Launcher', 'notes.txt', 'prepare.py']);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('these 2 files');
      expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
      expect(save).not.toHaveBeenCalled();
    });

    it('saves every unsaved tab and closes them all on Save All', async () => {
      const saveNotes = vi.fn<SaveTab>(() => Promise.resolve());
      const saveScript = vi.fn<SaveTab>(() => Promise.resolve());
      renderStrip({ 'notes.txt': saveNotes, 'prepare.py': saveScript });
      openMenu(/notes\.txt/);
      fireEvent.click(menuRow('Close All'));

      fireEvent.click(screen.getByText('Save All'));

      await waitFor(() => expect(tabNames()).toEqual(['Launcher']));
      expect(saveNotes).toHaveBeenCalledOnce();
      expect(saveScript).toHaveBeenCalledOnce();
    });

    it('closes what saved and keeps asking about the rest when a save fails', async () => {
      renderStrip({
        'notes.txt': () => Promise.resolve(),
        'prepare.py': () =>
          Promise.reject(new ApiError('PUT', '/api/contents', 403, 'read-only file system')),
      });
      openMenu(/notes\.txt/);
      fireEvent.click(menuRow('Close All'));

      fireEvent.click(screen.getByText('Save All'));

      expect(await screen.findByRole('alert')).toHaveTextContent('read-only file system');
      expect(tabNames()).toEqual(['Launcher', 'prepare.py']);
      expect(screen.getByRole('dialog')).toHaveTextContent('prepare.py');
    });
  });

  describe('the close chords', () => {
    it('closes the tab in front on Alt-W', () => {
      renderStrip();

      fireEvent.keyDown(window, { key: 'w', code: 'KeyW', altKey: true });

      expect(tabNames()).toEqual(['Launcher', 'prepare.py', 'Settings']);
    });

    it('closes every tab but the Launcher on Alt-Shift-W', () => {
      renderStrip();

      fireEvent.keyDown(window, { key: 'W', code: 'KeyW', altKey: true, shiftKey: true });

      expect(tabNames()).toEqual(['Launcher']);
    });
  });

  it('closes a tab whose contents match the file, with nothing to ask about', () => {
    const { container } = renderTabs();

    clickClose(container);

    expect(tabForNotes()).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // The dot is the strip's only sign of unsaved work. Queried by its name rather than its class,
  // because that name is the whole of what it says — a 6px circle has no text. It is an `aria-label`
  // and not a tooltip: the dot is inside the tab, whose own tooltip says it on a second line.
  it('marks a tab with unsaved changes', () => {
    renderTabs(() => Promise.resolve());

    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
  });

  it('marks nothing when every tab matches its file', () => {
    renderTabs();

    expect(screen.queryByLabelText('Unsaved changes')).not.toBeInTheDocument();
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

    function renderNotebookTab(notebookKernelMap: NotebookKernelMap) {
      return render(
        <Provider
          initialValues={[
            [fileTabsAtom, { Launcher: launcher, 'demo.ipynb': notebookTab }],
            [notebookKernelMapAtom, notebookKernelMap],
            [unsavedTabsAtom, {}],
          ]}
        >
          <TabIndex onShowFileBrowser={() => {}} />
          <Observer />
        </Provider>
      );
    }

    function tabForDemo(): HTMLElement | null {
      return screen.queryByRole('button', { name: /demo\.ipynb/ });
    }

    // The behaviour JupyterLab has: the tab goes, the kernel stays, and reopening the notebook joins
    // the session it is still on rather than starting a second kernel beside it.
    it('leaves the kernel running, and remembers it', () => {
      const { container } = renderNotebookTab({
        'demo.ipynb': { name: 'python3', id: 'kernel-1' },
      });

      clickClose(container);

      expect(tabForDemo()).not.toBeInTheDocument();
      expect(deleteKernel).not.toHaveBeenCalled();
      expect(screen.getByTestId('kernels')).toHaveTextContent('demo.ipynb');
    });

    // Closed while the session was still starting, or after starting one failed.
    it('closes cleanly when it never got a kernel', () => {
      const { container } = renderNotebookTab({});

      clickClose(container);

      expect(tabForDemo()).not.toBeInTheDocument();
      expect(deleteKernel).not.toHaveBeenCalled();
    });
  });

  describe('a strip wider than the window', () => {
    // jsdom lays nothing out: the strip shows 300px, every tab is 100px wide in strip order, and
    // scrollLeft is what the strip was moved by.
    function layOut() {
      let scrolled = 0;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement
      ) {
        if (this.classList.contains('tabHeader')) {
          return DOMRect.fromRect({ x: 0, width: 300, height: 30 });
        }
        const items = Array.from(document.querySelectorAll('.tab-item'));
        const index = items.indexOf(this.closest('.tab-item') as Element);
        return DOMRect.fromRect({ x: index * 100 - scrolled, width: 100, height: 30 });
      });
      const strip = document.querySelector('.tabHeader') as HTMLElement;
      Object.defineProperty(strip, 'scrollLeft', {
        get: () => scrolled,
        set: (value: number) => {
          scrolled = value;
        },
      });
      return () => scrolled;
    }

    it('scrolls the tab brought to the front into view, and no further', () => {
      renderStrip();
      const scrolled = layOut();

      fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
      expect(scrolled()).toBe(100);

      fireEvent.click(screen.getByRole('button', { name: /prepare\.py/ }));
      expect(scrolled()).toBe(100);

      fireEvent.click(screen.getByRole('button', { name: /Launcher/ }));
      expect(scrolled()).toBe(0);
      vi.restoreAllMocks();
    });

    it('scrolls sideways under a mouse wheel turned up or down, once the tabs overflow', () => {
      renderStrip();
      const scrolled = layOut();
      const strip = document.querySelector('.tabHeader') as HTMLElement;
      const overflow = (scrollWidth: number) => {
        Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: scrollWidth });
        Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 300 });
      };

      overflow(300);
      fireEvent.wheel(strip, { deltaY: 120 });
      expect(scrolled()).toBe(0);

      overflow(400);
      const turned = fireEvent.wheel(strip, { deltaY: 120 });
      expect(scrolled()).toBe(120);
      expect(turned).toBe(false);

      fireEvent.wheel(strip, { deltaY: 5, deltaX: 40 });
      expect(scrolled()).toBe(120);
      vi.restoreAllMocks();
    });
  });

  describe('reordering', () => {
    const order = () =>
      Array.from(document.querySelectorAll('.tab-item .tabName')).map((name) => name.textContent);
    const item = (name: RegExp) =>
      screen.getByRole('button', { name }).closest('.tab-item') as HTMLElement;
    // jsdom has no DataTransfer; what the strip asks of one is this much.
    const dataTransfer = () => {
      const data: Record<string, string> = {};
      return {
        setData: (type: string, value: string) => {
          data[type] = value;
        },
        getData: (type: string) => data[type] ?? '',
        get types() {
          return Object.keys(data);
        },
        effectAllowed: '',
        dropEffect: '',
      };
    };

    it('drops a tab dragged right after the tab it is let go on, with a bar on that side', () => {
      renderStrip();
      const transfer = dataTransfer();

      fireEvent.dragStart(item(/notes\.txt/), { dataTransfer: transfer });
      fireEvent.dragOver(item(/Settings/), { dataTransfer: transfer });
      expect(item(/Settings/)).toHaveClass('is-drop-after');
      expect(item(/notes\.txt/)).toHaveClass('is-dragged');

      fireEvent.drop(item(/Settings/), { dataTransfer: transfer });
      expect(order()).toEqual(['Launcher', 'prepare.py', 'Settings', 'notes.txt']);
      expect(document.querySelector('.is-drop-after, .is-dragged')).toBeNull();
    });

    it('does not take a drop on the Launcher, which stays first', () => {
      renderStrip();
      const transfer = dataTransfer();

      fireEvent.dragStart(item(/prepare\.py/), { dataTransfer: transfer });
      fireEvent.dragOver(item(/Launcher/), { dataTransfer: transfer });
      fireEvent.drop(item(/Launcher/), { dataTransfer: transfer });

      expect(order()).toEqual(['Launcher', 'notes.txt', 'prepare.py', 'Settings']);
      expect(screen.getByRole('button', { name: /Launcher/ })).toHaveAttribute(
        'draggable',
        'false'
      );
    });

    it('moves the tab in front a step with Move Tab Right, and not past the end', () => {
      let run: (id: string) => boolean = () => false;
      renderStrip({}, <Runner onReady={(runCommand) => (run = runCommand)} />);

      act(() => {
        run('tab:move-right');
      });
      expect(order()).toEqual(['Launcher', 'prepare.py', 'notes.txt', 'Settings']);
      act(() => {
        run('tab:move-right');
      });
      act(() => {
        run('tab:move-right');
      });
      expect(order()).toEqual(['Launcher', 'prepare.py', 'Settings', 'notes.txt']);
      act(() => {
        run('tab:move-left');
      });
      expect(order()).toEqual(['Launcher', 'prepare.py', 'notes.txt', 'Settings']);
    });
  });
});
