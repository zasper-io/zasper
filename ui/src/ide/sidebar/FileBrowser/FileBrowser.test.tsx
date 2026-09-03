import React from 'react';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileBrowser from './FileBrowser';
import { ApiError } from '@/api/client';
import { fileTabsAtom } from '@/store/TabState';

const getDirectory = vi.fn();
const createContent = vi.fn();
const renameContent = vi.fn();
const deleteContent = vi.fn();
const moveContent = vi.fn();
const copyContent = vi.fn();
const downloadContent = vi.fn();
const uploadFile = vi.fn();
const saveAs = vi.fn();
const copyToClipboard = vi.fn();

vi.mock('@/api', async () => ({
  getDirectory: (path: string) => getDirectory(path),
  createContent: (parentDir: string, type: string) => createContent(parentDir, type),
  renameContent: (parentDir: string, oldName: string, newName: string) =>
    renameContent(parentDir, oldName, newName),
  deleteContent: (path: string) => deleteContent(path),
  moveContent: (from: string, to: string) => moveContent(from, to),
  copyContent: (from: string, toDir: string) => copyContent(from, toDir),
  downloadContent: (path: string) => downloadContent(path),
  uploadFile: (request: unknown) => uploadFile(request),
  deleteKernel: vi.fn(),
  logApiError: () => () => {},
  // Not stubbed: what it reads out of a rejected request is what the panel shows, and the status on
  // it is how an upload tells a name that is taken from a failure it cannot answer.
  apiErrorMessage: (await import('@/api/client')).apiErrorMessage,
  ApiError: (await import('@/api/client')).ApiError,
}));

// The two things only a browser can do: put a file on the reader's disk, and write their clipboard.
vi.mock('@/browser', () => ({
  saveAs: (blob: Blob, name: string) => saveAs(blob, name),
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

const rootListing = {
  name: '',
  path: '',
  type: 'directory',
  content: [
    { name: 'src', path: 'src', type: 'directory', content: [] },
    { name: 'notes.txt', path: 'notes.txt', type: 'file', content: [] },
    {
      name: 'build.log',
      path: 'build.log',
      type: 'file',
      content: [],
      size: 2048,
      last_modified: '2026-01-02T03:04:05Z',
      writable: false,
      ignored: true,
    },
    { name: '.env', path: '.env', type: 'file', content: [] },
  ],
};

const srcListing = {
  name: 'src',
  path: 'src',
  type: 'directory',
  content: [{ name: 'main.py', path: 'src/main.py', type: 'file', content: [] }],
};

/** The tabs the panel has opened, Launcher aside. */
function OpenTabs() {
  const tabs = useAtomValue(fileTabsAtom);
  return (
    <span data-testid="tabs">
      {Object.keys(tabs)
        .filter((key) => key !== 'Launcher')
        .join(',')}
    </span>
  );
}

let tree: HTMLElement;

async function renderBrowser() {
  const { container } = render(
    <Provider>
      <FileBrowser hidden={false} reloadCount={0} />
      <OpenTabs />
    </Provider>
  );
  // Scoped to the tree, so the open-tabs readout above cannot answer a query about a row.
  tree = container.querySelector('.content-inner') as HTMLElement;
  await within(tree).findByText('notes.txt');
}

/** The clickable row for a name, which is what carries the open/active state. */
function row(name: string): HTMLElement {
  return within(tree).getByText(name).closest('a') as HTMLElement;
}

function openMenu(name: string, item: string) {
  fireEvent.contextMenu(row(name));
  fireEvent.click(screen.getByText(item));
}

function openTabs(): string {
  return screen.getByTestId('tabs').textContent ?? '';
}

/** Expands `src` and waits for what it holds. */
async function expandSrc() {
  fireEvent.click(row('src'));
  await within(tree).findByText('main.py');
}

describe('FileBrowser', () => {
  beforeEach(() => {
    // The panel opens a watch socket on mount, which has nothing to say to a test and no backend to
    // say it to.
    vi.stubGlobal(
      'WebSocket',
      class {
        close() {}
      }
    );
    [
      getDirectory,
      createContent,
      renameContent,
      deleteContent,
      moveContent,
      copyContent,
      downloadContent,
      uploadFile,
      saveAs,
      copyToClipboard,
    ].forEach((mock) => mock.mockReset());
    getDirectory.mockImplementation((path: string) =>
      Promise.resolve(path === '' ? rootListing : srcListing)
    );
    createContent.mockResolvedValue({});
    renameContent.mockResolvedValue(undefined);
    deleteContent.mockResolvedValue(undefined);
    moveContent.mockResolvedValue(undefined);
    copyContent.mockResolvedValue(undefined);
    downloadContent.mockResolvedValue(new Blob(['hello']));
    uploadFile.mockResolvedValue({});
    copyToClipboard.mockResolvedValue(true);
  });

  it('lists the project root', async () => {
    await renderBrowser();

    expect(row('src')).toBeInTheDocument();
    expect(row('notes.txt')).toBeInTheDocument();
  });

  it('opens a file in a tab, and marks the row of the tab in front', async () => {
    await renderBrowser();

    fireEvent.click(row('notes.txt'));

    expect(openTabs()).toBe('notes.txt');
    expect(row('notes.txt')).toHaveClass('active');
    expect(row('src')).not.toHaveClass('active');
  });

  describe('a folder', () => {
    it('lists its contents when expanded', async () => {
      await renderBrowser();

      fireEvent.click(row('src'));

      expect(await within(tree).findByText('main.py')).toBeInTheDocument();
      expect(getDirectory).toHaveBeenCalledWith('src');
    });

    it('is collapsed without fetching it again', async () => {
      await renderBrowser();
      await expandSrc();

      fireEvent.click(row('src'));

      await waitFor(() => expect(within(tree).queryByText('main.py')).not.toBeInTheDocument());
      expect(getDirectory).toHaveBeenCalledTimes(2); // the root, then src once
    });
  });

  describe('re-reading the tree', () => {
    it('leaves open what was open', async () => {
      await renderBrowser();
      await expandSrc();

      fireEvent.click(screen.getByTitle('Refresh'));

      await waitFor(() => expect(getDirectory).toHaveBeenCalledTimes(4)); // '', src, then both again
      expect(getDirectory).toHaveBeenLastCalledWith('src');
      // The point of holding the listings in one store: a folder that was open stays open, and shows
      // what it holds now.
      expect(within(tree).getByText('main.py')).toBeInTheDocument();
    });

    it('lets go of a folder that has gone from disk, without complaining about it', async () => {
      await renderBrowser();
      await expandSrc();
      getDirectory.mockImplementation((path: string) =>
        path === ''
          ? Promise.resolve({ ...rootListing, content: [rootListing.content[1]] })
          : Promise.reject(new ApiError('POST', '/api/contents', 404, '{"message":"not found"}'))
      );

      fireEvent.click(screen.getByTitle('Refresh'));

      await waitFor(() => expect(within(tree).queryByText('src')).not.toBeInTheDocument());
      expect(within(tree).queryByText('main.py')).not.toBeInTheDocument();
      // The listing it was in already says it has gone; an error strip on top of that is noise.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says why when the root cannot be read', async () => {
      await renderBrowser();
      getDirectory.mockRejectedValue(
        new ApiError('POST', '/api/contents', 500, '{"message":"permission denied"}')
      );

      fireEvent.click(screen.getByTitle('Refresh'));

      expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
    });

    it('leaves the tree alone when the server cannot be reached at all', async () => {
      await renderBrowser();
      await expandSrc();
      getDirectory.mockRejectedValue(new TypeError('Failed to fetch'));

      fireEvent.click(screen.getByTitle('Refresh'));

      await screen.findByRole('alert');
      // Nothing has been deleted; there is only nobody to ask. Closing every open folder over a
      // server restart is the wrong answer to that.
      expect(within(tree).getByText('main.py')).toBeInTheDocument();
    });

    it('takes the message down once the tree reads again', async () => {
      await renderBrowser();
      getDirectory.mockRejectedValue(new ApiError('POST', '/api/contents', 503, ''));
      fireEvent.click(screen.getByTitle('Refresh'));
      await screen.findByRole('alert');

      // The server came back — by itself, as far as the panel is concerned.
      getDirectory.mockImplementation(() => Promise.resolve(rootListing));
      fireEvent.click(screen.getByTitle('Refresh'));

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
  });

  describe('re-rooting', () => {
    /** The trail in the banner, which is both where the tree is rooted and the way back out. */
    function trail(): HTMLElement {
      return screen.getByLabelText('Folder in view');
    }

    /** Roots the tree at `src` and waits for the view to be inside it. */
    async function rootAtSrc() {
      openMenu('src', 'Open as Root');
      await within(tree).findByText('main.py');
    }

    it('shows only what is inside the folder it was rooted at', async () => {
      await renderBrowser();

      await rootAtSrc();

      expect(within(tree).getByText('main.py')).toBeInTheDocument();
      expect(within(tree).queryByText('notes.txt')).not.toBeInTheDocument();
    });

    it('names the trail down to it, and goes back up when a crumb is clicked', async () => {
      await renderBrowser();
      await rootAtSrc();
      expect(within(trail()).getByTitle('src')).toHaveAttribute('aria-current', 'location');

      fireEvent.click(within(trail()).getByTitle('Project root'));

      expect(await within(tree).findByText('notes.txt')).toBeInTheDocument();
      expect(within(trail()).queryByTitle('src')).not.toBeInTheDocument();
    });

    it('creates into the folder in view rather than the project root', async () => {
      await renderBrowser();
      await rootAtSrc();

      fireEvent.click(screen.getByTitle('New file'));

      await waitFor(() => expect(createContent).toHaveBeenCalledWith('src', 'file'));
    });

    it('uploads into the folder in view', async () => {
      await renderBrowser();
      await rootAtSrc();

      fireEvent.contextMenu(tree);
      fireEvent.click(screen.getByText('Upload'));

      expect(screen.getByRole('dialog')).toHaveTextContent('Into src');
    });

    it('falls back to the parent when the folder in view has gone from disk', async () => {
      await renderBrowser();
      await rootAtSrc();
      getDirectory.mockImplementation((path: string) =>
        path === 'src'
          ? Promise.reject(new ApiError('POST', '/api/contents', 404, '{"message":"not found"}'))
          : Promise.resolve(rootListing)
      );

      fireEvent.click(screen.getByTitle('Refresh'));

      // A view of a folder that is not there has nothing in it and no way out of it.
      expect(await within(tree).findByText('notes.txt')).toBeInTheDocument();
      expect(within(trail()).queryByTitle('src')).not.toBeInTheDocument();
    });
  });

  describe('renaming', () => {
    async function rename(from: string, to: string) {
      openMenu(from, 'Rename');
      const input = within(tree).getByRole('textbox');
      fireEvent.change(input, { target: { value: to } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(renameContent).toHaveBeenCalled());
    }

    it('renames the file and takes its open tab with it', async () => {
      await renderBrowser();
      fireEvent.click(row('notes.txt'));

      await rename('notes.txt', 'todo.txt');

      expect(renameContent).toHaveBeenCalledWith('', 'notes.txt', 'todo.txt');
      expect(await within(tree).findByText('todo.txt')).toBeInTheDocument();
      // Otherwise the tab still points at the old path and writes it back on the next save.
      expect(openTabs()).toBe('todo.txt');
    });

    it('keeps a renamed folder open, with what it holds', async () => {
      await renderBrowser();
      await expandSrc();

      await rename('src', 'lib');

      expect(within(tree).getByText('main.py')).toBeInTheDocument();
      // Not 'src': the folder that is open is the one that now exists.
      fireEvent.click(screen.getByTitle('Refresh'));
      await waitFor(() => expect(getDirectory).toHaveBeenLastCalledWith('lib'));
    });

    it('keeps the old name and says why when the server refuses', async () => {
      renameContent.mockRejectedValue(
        new ApiError(
          'POST',
          '/api/contents/rename',
          409,
          JSON.stringify({ message: 'a file or folder with that name already exists' })
        )
      );
      await renderBrowser();

      await rename('notes.txt', 'src');

      expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
      expect(within(tree).getByText('notes.txt')).toBeInTheDocument();
    });
  });

  describe('deleting', () => {
    it('asks first, and does nothing when the answer is Cancel', async () => {
      await renderBrowser();

      openMenu('notes.txt', 'Delete');

      expect(screen.getByRole('dialog')).toHaveTextContent('notes.txt');
      fireEvent.click(screen.getByText('Cancel'));
      expect(deleteContent).not.toHaveBeenCalled();
      expect(within(tree).getByText('notes.txt')).toBeInTheDocument();
    });

    it('deletes the file and closes its tab when confirmed', async () => {
      await renderBrowser();
      fireEvent.click(row('notes.txt'));
      openMenu('notes.txt', 'Delete');

      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => expect(deleteContent).toHaveBeenCalledWith('notes.txt'));
      await waitFor(() => expect(within(tree).queryByText('notes.txt')).not.toBeInTheDocument());
      expect(openTabs()).toBe('');
    });

    it('leaves the row where it is when the server refuses', async () => {
      deleteContent.mockRejectedValue(
        new ApiError(
          'DELETE',
          '/api/contents',
          400,
          JSON.stringify({ message: 'directory not empty' })
        )
      );
      await renderBrowser();
      openMenu('src', 'Delete Folder');

      fireEvent.click(screen.getByText('Delete'));

      expect(await screen.findByRole('alert')).toHaveTextContent('directory not empty');
      expect(within(tree).getByText('src')).toBeInTheDocument();
    });

    it('warns that a folder takes everything inside it', async () => {
      await renderBrowser();

      openMenu('src', 'Delete Folder');

      expect(screen.getByRole('dialog')).toHaveTextContent('everything inside it');
    });
  });

  describe('the context menu', () => {
    it('closes on Escape', async () => {
      await renderBrowser();
      fireEvent.contextMenu(row('notes.txt'));

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes when something else is pressed', async () => {
      await renderBrowser();
      fireEvent.contextMenu(row('notes.txt'));

      fireEvent.mouseDown(row('src'));

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('leaves only one menu open when a second row is right-clicked', async () => {
      await renderBrowser();
      fireEvent.contextMenu(row('notes.txt'));

      fireEvent.mouseDown(row('src'));
      fireEvent.contextMenu(row('src'));

      expect(screen.getAllByRole('menu')).toHaveLength(1);
      expect(screen.getByText('Delete Folder')).toBeInTheDocument();
    });
  });

  describe('the toolbar', () => {
    /** A create whose new row the next listing brings in, as the server behaves. */
    function creates(entry: { name: string; path: string; type: string }) {
      createContent.mockResolvedValue(entry);
      getDirectory.mockImplementation((path: string) =>
        Promise.resolve(
          path === '' ? { ...rootListing, content: [...rootListing.content, entry] } : srcListing
        )
      );
    }

    it('creates a file at the root and shows it', async () => {
      await renderBrowser();
      creates({ name: 'untitled.txt', path: 'untitled.txt', type: 'file' });

      fireEvent.click(screen.getByTitle('New file'));

      // It arrives with its rename box open; Escape takes the offer back and leaves the row.
      fireEvent.keyDown(await within(tree).findByRole('textbox'), { key: 'Escape' });
      expect(within(tree).getByText('untitled.txt')).toBeInTheDocument();
      expect(createContent).toHaveBeenCalledWith('', 'file');
    });

    it('opens the rename box on what it made, since the server picked the name', async () => {
      await renderBrowser();
      creates({ name: 'untitled-directory', path: 'untitled-directory', type: 'directory' });

      fireEvent.click(screen.getByTitle('New folder'));

      const input = (await within(tree).findByRole('textbox')) as HTMLInputElement;
      expect(input.value).toBe('untitled-directory');
      // And only that row: the rest of the tree is not waiting to be renamed.
      expect(within(tree).getAllByRole('textbox')).toHaveLength(1);
    });

    it('says why when the create fails', async () => {
      await renderBrowser();
      createContent.mockRejectedValue(
        new ApiError('POST', '/api/contents/create', 403, '{"message":"read-only file system"}')
      );

      fireEvent.click(screen.getByTitle('New file'));

      expect(await screen.findByRole('alert')).toHaveTextContent('read-only file system');
    });

    it('creates a notebook at the root, which only the Launcher could do before', async () => {
      await renderBrowser();
      creates({ name: 'Untitled.ipynb', path: 'Untitled.ipynb', type: 'notebook' });

      fireEvent.click(screen.getByTitle('New notebook'));

      await waitFor(() => expect(createContent).toHaveBeenCalledWith('', 'notebook'));
    });

    it('offers the same actions on empty space, which has no row to right-click', async () => {
      await renderBrowser();

      fireEvent.contextMenu(tree);

      expect(screen.getByRole('menu')).toBeInTheDocument();
      creates({ name: 'untitled-directory', path: 'untitled-directory', type: 'directory' });
      fireEvent.click(screen.getByText('Add Folder'));

      await waitFor(() => expect(createContent).toHaveBeenCalledWith('', 'directory'));
    });

    it('leaves the root menu shut when a row is right-clicked', async () => {
      await renderBrowser();

      fireEvent.contextMenu(row('notes.txt'));

      // Both menus would open at once otherwise: the row's, and the panel's behind it.
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  describe('what the tree shows', () => {
    it('keeps dotfiles out of the way until they are asked for', async () => {
      await renderBrowser();
      expect(within(tree).queryByText('.env')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTitle('Show hidden files'));

      expect(within(tree).getByText('.env')).toBeInTheDocument();
    });

    it('dims what git would not track, and says so in the tooltip', async () => {
      await renderBrowser();

      // Dimmed rather than hidden: build output is still worth opening.
      expect(row('build.log')).toHaveClass('is-ignored');
      expect(row('build.log').title).toContain('ignored by git');
    });

    it('marks a row that cannot be written', async () => {
      await renderBrowser();

      expect(within(row('build.log')).getByLabelText('Read-only')).toBeInTheDocument();
      expect(row('notes.txt').querySelector('.rowFlag')).toBeNull();
    });

    it('puts the size and the date the server already sent in the tooltip', async () => {
      await renderBrowser();

      expect(row('build.log').title).toContain('2 kB');
      expect(row('build.log').title).toContain('build.log');
    });

    it('says that an empty folder is empty rather than showing nothing', async () => {
      getDirectory.mockImplementation((path: string) =>
        Promise.resolve(path === '' ? rootListing : { ...srcListing, content: [] })
      );
      await renderBrowser();

      fireEvent.click(row('src'));

      expect(await within(tree).findByText('Empty')).toBeInTheDocument();
    });

    it('says that a folder could not be read', async () => {
      await renderBrowser();
      getDirectory.mockRejectedValue(new ApiError('POST', '/api/contents', 403, ''));

      fireEvent.click(row('src'));

      expect(await within(tree).findByText('Could not be read')).toBeInTheDocument();
    });
  });

  describe('the filter', () => {
    function filterFor(text: string) {
      fireEvent.change(screen.getByLabelText('Filter files'), { target: { value: text } });
    }

    it('narrows the tree to what matches', async () => {
      await renderBrowser();

      filterFor('notes');

      expect(within(tree).getByText('notes.txt')).toBeInTheDocument();
      expect(within(tree).queryByText('build.log')).not.toBeInTheDocument();
      // Nothing has been read below it, so there is nothing in it that could match.
      expect(within(tree).queryByText('src')).not.toBeInTheDocument();
    });

    it('keeps the folders above a match on screen', async () => {
      await renderBrowser();
      await expandSrc();

      filterFor('main');

      // Otherwise the match disappears with the parent it is inside.
      expect(within(tree).getByText('src')).toBeInTheDocument();
      expect(within(tree).getByText('main.py')).toBeInTheDocument();
      expect(within(tree).queryByText('notes.txt')).not.toBeInTheDocument();
    });

    it('says when nothing matched, rather than emptying the panel', async () => {
      await renderBrowser();

      filterFor('nothing-is-called-this');

      expect(within(tree).getByText('No matches here')).toBeInTheDocument();
    });

    it('closes every open folder on collapse-all', async () => {
      await renderBrowser();
      await expandSrc();

      fireEvent.click(screen.getByLabelText('Collapse all folders'));

      expect(within(tree).queryByText('main.py')).not.toBeInTheDocument();
    });
  });

  describe('the clipboard', () => {
    it('offers no Paste before anything has been cut or copied', async () => {
      await renderBrowser();

      fireEvent.contextMenu(row('src'));

      expect(screen.queryByText('Paste')).not.toBeInTheDocument();
    });

    it('moves what was cut, on the paste rather than on the cut', async () => {
      await renderBrowser();

      openMenu('notes.txt', 'Cut');
      // Nothing has happened on disk yet: a cut that is never pasted has moved nothing.
      expect(moveContent).not.toHaveBeenCalled();
      openMenu('src', 'Paste');

      await waitFor(() => expect(moveContent).toHaveBeenCalledWith('notes.txt', 'src/notes.txt'));
    });

    it('spends a cut but keeps a copy, so the same file can be pasted again', async () => {
      await renderBrowser();

      openMenu('notes.txt', 'Copy');
      openMenu('src', 'Paste');
      await waitFor(() => expect(copyContent).toHaveBeenCalledWith('notes.txt', 'src'));

      fireEvent.contextMenu(row('src'));
      expect(screen.getByText('Paste')).toBeInTheDocument();
    });

    it('duplicates into the folder the row is already in', async () => {
      await renderBrowser();

      openMenu('notes.txt', 'Duplicate');

      await waitFor(() => expect(copyContent).toHaveBeenCalledWith('notes.txt', ''));
    });

    it('refuses to paste a folder inside itself', async () => {
      await renderBrowser();

      openMenu('src', 'Cut');
      openMenu('src', 'Paste');

      expect(await screen.findByRole('alert')).toHaveTextContent('inside itself');
      expect(moveContent).not.toHaveBeenCalled();
    });
  });

  describe('more than one row', () => {
    /** Adds a row to the selection the way a cmd-click does. */
    function alsoSelect(name: string) {
      fireEvent.click(row(name), { metaKey: true });
    }

    it('adds a row to the selection without opening it', async () => {
      await renderBrowser();
      fireEvent.click(row('notes.txt'));

      alsoSelect('build.log');

      expect(row('notes.txt')).toHaveClass('is-selected');
      expect(row('build.log')).toHaveClass('is-selected');
      // A cmd-click is building a selection and nothing more.
      expect(openTabs()).toBe('notes.txt');
    });

    it('takes the range between on a shift-click, in the order the rows appear', async () => {
      await renderBrowser();
      fireEvent.click(row('notes.txt'));

      fireEvent.click(row('build.log'), { shiftKey: true });

      expect(row('notes.txt')).toHaveClass('is-selected');
      expect(row('build.log')).toHaveClass('is-selected');
      expect(row('src')).not.toHaveClass('is-selected');
    });

    it('acts on the whole selection', async () => {
      await renderBrowser();
      fireEvent.click(row('notes.txt'));
      alsoSelect('build.log');

      openMenu('build.log', 'Cut');
      openMenu('src', 'Paste');

      await waitFor(() => expect(moveContent).toHaveBeenCalledTimes(2));
      expect(moveContent).toHaveBeenCalledWith('notes.txt', 'src/notes.txt');
      expect(moveContent).toHaveBeenCalledWith('build.log', 'src/build.log');
    });

    it('deletes the selection once, having said how much of it there is', async () => {
      await renderBrowser();
      fireEvent.click(row('notes.txt'));
      alsoSelect('build.log');

      openMenu('build.log', 'Delete 2 Items');

      expect(screen.getByRole('dialog')).toHaveTextContent('2 items');
      fireEvent.click(screen.getByText('Delete'));
      await waitFor(() => expect(deleteContent).toHaveBeenCalledTimes(2));
    });

    it('acts on the row that was right-clicked when it is outside the selection', async () => {
      await renderBrowser();
      fireEvent.click(row('notes.txt'));
      alsoSelect('build.log');

      fireEvent.contextMenu(row('src'));

      // Not 'Delete 3 Items': the pointer was nowhere near the other two.
      expect(screen.getByText('Delete Folder')).toBeInTheDocument();
      expect(row('notes.txt')).not.toHaveClass('is-selected');
    });

    it('drops the selection on a click in the empty space below the tree', async () => {
      await renderBrowser();
      fireEvent.click(row('notes.txt'));

      fireEvent.click(tree);

      expect(row('notes.txt')).not.toHaveClass('is-selected');
    });
  });

  describe('dragging rows', () => {
    /** Enough of a DataTransfer for the tree: it only ever carries its own paths. */
    function dataTransfer(): DataTransfer {
      const held: Record<string, string> = {};
      return {
        get types() {
          return Object.keys(held);
        },
        setData: (type: string, value: string) => {
          held[type] = value;
        },
        getData: (type: string) => held[type] ?? '',
      } as unknown as DataTransfer;
    }

    // jsdom builds a drag event without the modifier keys, so a held Alt has to be put on by hand.
    function dragEvent(
      kind: 'dragOver' | 'drop',
      target: HTMLElement,
      carried: DataTransfer,
      held: boolean
    ) {
      const event = createEvent[kind](target, { dataTransfer: carried });
      Object.defineProperty(event, 'altKey', { value: held });
      fireEvent(target, event);
    }

    function drag(from: string, to: string, held = false) {
      const carried = dataTransfer();
      fireEvent.dragStart(row(from), { dataTransfer: carried });
      dragEvent('dragOver', row(to), carried, held);
      dragEvent('drop', row(to), carried, held);
    }

    it('moves a row dropped on a folder', async () => {
      await renderBrowser();

      drag('notes.txt', 'src');

      await waitFor(() => expect(moveContent).toHaveBeenCalledWith('notes.txt', 'src/notes.txt'));
    });

    it('copies instead when the drop is held', async () => {
      await renderBrowser();

      drag('notes.txt', 'src', true);

      await waitFor(() => expect(copyContent).toHaveBeenCalledWith('notes.txt', 'src'));
      expect(moveContent).not.toHaveBeenCalled();
    });

    it('says why when the server refuses the move', async () => {
      moveContent.mockRejectedValue(
        new ApiError('POST', '/api/contents/move', 409, '{"message":"that name is taken"}')
      );
      await renderBrowser();

      drag('notes.txt', 'src');

      // Waited out on purpose: the re-read of both ends that follows a move succeeds, and a listing
      // that reads clears the error strip, so reporting any earlier than that would leave the drop
      // looking like it did nothing at all.
      await waitFor(() => expect(getDirectory).toHaveBeenCalledTimes(3));
      expect(screen.getByRole('alert')).toHaveTextContent('that name is taken');
    });

    it('carries the whole selection', async () => {
      await renderBrowser();
      fireEvent.click(row('notes.txt'));
      fireEvent.click(row('build.log'), { metaKey: true });

      drag('build.log', 'src');

      await waitFor(() => expect(moveContent).toHaveBeenCalledTimes(2));
    });

    it('shows where a drop would land, and refuses a folder onto itself', async () => {
      await renderBrowser();
      const carried = dataTransfer();

      fireEvent.dragStart(row('src'), { dataTransfer: carried });
      fireEvent.dragOver(row('src'), { dataTransfer: carried });

      expect(row('src')).not.toHaveClass('is-drop-target');

      fireEvent.dragOver(row('notes.txt'), { dataTransfer: carried });
      // A file is not a destination; only folders and the empty space are.
      expect(row('notes.txt')).not.toHaveClass('is-drop-target');
    });
  });

  describe('uploading', () => {
    /** A file as jsdom builds it: the path a folder input fills in has to be put on by hand. */
    function fileNamed(name: string, relativePath = ''): File {
      const file = new File(['x'], name);
      Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
      return file;
    }

    /** Files dragged in from the desktop. No entries, which is a plain file drop rather than a folder. */
    function fromTheDesktop(...files: File[]): DataTransfer {
      return { types: ['Files'], items: [], files } as unknown as DataTransfer;
    }

    /** Drops files somewhere, which is what opens the dialog with them already queued. */
    function dropOn(target: HTMLElement, ...files: File[]) {
      const carried = fromTheDesktop(...files);
      fireEvent.dragOver(target, { dataTransfer: carried });
      fireEvent.drop(target, { dataTransfer: carried });
    }

    const refused = (status: number, message: string) =>
      new ApiError('POST', '/api/contents/upload', status, JSON.stringify({ message }));

    it('shows a folder as a destination while files are dragged over it', async () => {
      await renderBrowser();

      fireEvent.dragOver(row('src'), { dataTransfer: fromTheDesktop(fileNamed('a.txt')) });

      expect(row('src')).toHaveClass('is-drop-target');
    });

    it('uploads what was dropped into the folder it landed on, and then closes', async () => {
      await renderBrowser();

      dropOn(row('src'), fileNamed('notes.txt'));

      await waitFor(() =>
        expect(uploadFile).toHaveBeenCalledWith(
          expect.objectContaining({ parentDir: 'src', relativePath: 'notes.txt', replace: false })
        )
      );
      // Read again and opened, so the row that has just arrived is there to be seen.
      await waitFor(() => expect(getDirectory).toHaveBeenCalledWith('src'));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('takes a drop in the empty space as the project root', async () => {
      await renderBrowser();

      dropOn(tree, fileNamed('notes.txt'));

      await waitFor(() =>
        expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ parentDir: '' }))
      );
    });

    it('sends one file at a time', async () => {
      const finish: Array<() => void> = [];
      uploadFile.mockImplementation(
        () => new Promise<object>((resolve) => finish.push(() => resolve({})))
      );
      await renderBrowser();

      dropOn(row('src'), fileNamed('a.txt'), fileNamed('b.txt'));

      // A folder of a hundred files should not open a hundred connections.
      await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
      finish[0]();
      await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    });

    it('offers to replace a name that is already taken', async () => {
      uploadFile.mockRejectedValueOnce(refused(409, 'notes.txt already exists'));
      await renderBrowser();

      dropOn(row('src'), fileNamed('notes.txt'));

      // The 409 is answered rather than reported: overwriting has to be asked for.
      fireEvent.click(await screen.findByText('Replace'));

      await waitFor(() =>
        expect(uploadFile).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }))
      );
    });

    it('says why a file did not go, and stays open about it', async () => {
      uploadFile.mockRejectedValue(refused(403, 'the folder is read-only'));
      await renderBrowser();

      dropOn(row('src'), fileNamed('notes.txt'));

      expect(await screen.findByText('the folder is read-only')).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Upload' })).toBeInTheDocument();
    });

    it('keeps the structure of a chosen folder', async () => {
      await renderBrowser();
      openMenu('src', 'Upload');

      fireEvent.change(screen.getByLabelText('Folder'), {
        target: { files: [fileNamed('logo.png', 'img/logo.png')] },
      });

      await waitFor(() =>
        expect(uploadFile).toHaveBeenCalledWith(
          expect.objectContaining({ parentDir: 'src', relativePath: 'img/logo.png' })
        )
      );
    });

    it('stops what is still going out when it is closed', async () => {
      let carried: AbortSignal | undefined;
      uploadFile.mockImplementation((request: { signal?: AbortSignal }) => {
        carried = request.signal;
        return new Promise<object>(() => {});
      });
      await renderBrowser();
      dropOn(row('src'), fileNamed('a.txt'));
      await waitFor(() => expect(uploadFile).toHaveBeenCalled());

      fireEvent.click(screen.getByText('Cancel'));

      // Safe to cut off mid-file: the server renames an upload into place only once it is whole.
      expect(carried?.aborted).toBe(true);
    });
  });

  describe('the rest of a row menu', () => {
    it('downloads a file under its own name', async () => {
      await renderBrowser();

      openMenu('notes.txt', 'Download');

      await waitFor(() => expect(downloadContent).toHaveBeenCalledWith('notes.txt'));
      expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'notes.txt');
    });

    it('copies the path', async () => {
      await renderBrowser();
      await expandSrc();

      openMenu('main.py', 'Copy Path');

      await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('src/main.py'));
    });

    it('says so when the browser will not allow the clipboard', async () => {
      copyToClipboard.mockResolvedValue(false);
      await renderBrowser();

      openMenu('notes.txt', 'Copy Path');

      // A copy that quietly did nothing is worse than one that says so.
      expect(await screen.findByRole('alert')).toHaveTextContent('clipboard');
    });

    it('opens a terminal from a folder', async () => {
      await renderBrowser();

      openMenu('src', 'Open Terminal Here');

      expect(openTabs()).toContain('Terminal 1');
    });
  });

  describe('the keyboard', () => {
    function press(key: string, options: object = {}) {
      fireEvent.keyDown(within(tree).getByRole('tree'), { key, ...options });
    }

    it('walks the rows, taking the selection with it', async () => {
      await renderBrowser();

      press('ArrowDown');
      expect(row('src')).toHaveClass('is-selected');

      press('ArrowDown');
      expect(row('notes.txt')).toHaveClass('is-selected');
      expect(row('src')).not.toHaveClass('is-selected');
    });

    it('stops at the last row rather than losing the focus off the end', async () => {
      await renderBrowser();

      press('End');
      press('ArrowDown');

      expect(row('build.log')).toHaveClass('is-selected');
    });

    it('opens a folder with ArrowRight and closes it with ArrowLeft', async () => {
      await renderBrowser();
      press('ArrowDown');

      press('ArrowRight');
      expect(await within(tree).findByText('main.py')).toBeInTheDocument();

      press('ArrowLeft');
      expect(within(tree).queryByText('main.py')).not.toBeInTheDocument();
    });

    it('walks into an open folder rather than opening it again', async () => {
      await renderBrowser();
      await expandSrc();
      press('ArrowDown');

      press('ArrowRight');

      expect(row('main.py')).toHaveClass('is-selected');
    });

    it('steps back out to the folder holding a row, leaving it open', async () => {
      await renderBrowser();
      await expandSrc();
      press('ArrowDown');
      press('ArrowRight');

      press('ArrowLeft');

      // Focus bubbles out of a row into the row holding it, so a focused child used to make its own
      // folder the focused row — and this key then closed it instead of stepping to it.
      expect(row('main.py')).toBeInTheDocument();
      expect(row('src')).toHaveClass('is-selected');
    });

    it('opens a file on Enter', async () => {
      await renderBrowser();
      press('ArrowDown');
      press('ArrowDown');

      press('Enter');

      expect(openTabs()).toBe('notes.txt');
    });

    it('renames on F2 and asks to delete on Delete', async () => {
      await renderBrowser();
      press('ArrowDown');

      press('F2');
      expect((within(tree).getByRole('textbox') as HTMLInputElement).value).toBe('src');
      fireEvent.keyDown(within(tree).getByRole('textbox'), { key: 'Escape' });

      press('Delete');
      expect(screen.getByRole('dialog')).toHaveTextContent('src');
    });

    it('selects every row on screen, and drops it again on Escape', async () => {
      await renderBrowser();

      press('a', { metaKey: true });
      expect(row('src')).toHaveClass('is-selected');
      expect(row('build.log')).toHaveClass('is-selected');

      press('Escape');
      expect(row('src')).not.toHaveClass('is-selected');
    });

    it('cuts and pastes into the folder the focus is in', async () => {
      await renderBrowser();
      press('ArrowDown');
      press('ArrowDown');

      press('x', { metaKey: true });
      press('ArrowUp');
      press('v', { metaKey: true });

      await waitFor(() => expect(moveContent).toHaveBeenCalledWith('notes.txt', 'src/notes.txt'));
    });

    it('leaves the keys of the rename box to the rename box', async () => {
      await renderBrowser();
      press('ArrowDown');
      press('F2');

      const input = within(tree).getByRole('textbox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });

      // Still the box: an arrow key in there is moving the caret, not the tree's focus.
      expect(within(tree).getByRole('textbox')).toBe(input);
    });
  });
});
