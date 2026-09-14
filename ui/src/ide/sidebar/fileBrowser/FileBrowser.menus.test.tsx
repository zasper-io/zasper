import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileBrowser from './FileBrowser';
import { ApiError } from '@/api/client';
import {
  copyToClipboard,
  createContent,
  downloadContent,
  getDirectory,
  renameContent,
  saveAs,
} from './fileBrowserFakes';
import {
  expandSrc,
  openMenu,
  openTabs,
  renderBrowser,
  rootListing,
  row,
  setUpFileBrowser,
  srcListing,
  tree,
} from './fileBrowserTestKit';

vi.mock('@/api', async () => (await import('./fileBrowserFakes')).apiModule());
vi.mock('@/browser', async () => (await import('./fileBrowserFakes')).browserModule());

describe('FileBrowser', () => {
  beforeEach(setUpFileBrowser);

  describe('the context menu', () => {
    it('closes on Escape', async () => {
      await renderBrowser();
      fireEvent.contextMenu(row('notes.txt'));

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    // Same swallow, and the menu is where it would have been noticed second: its items are buttons now,
    // so one of them can hold the focus when Escape arrives.
    it('closes on Escape pressed on one of its own items', async () => {
      await renderBrowser();
      fireEvent.contextMenu(row('notes.txt'));

      fireEvent.keyDown(screen.getByText('Rename'), { key: 'Escape' });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    // And the way it actually happens in a browser, which no jsdom test would have thought to try: a
    // right-click leaves the focus on the row, so Escape arrives at the tree from the row rather than
    // from the menu. It is still the menu's.
    it('closes on Escape while the row it belongs to holds the focus', async () => {
      await renderBrowser();
      fireEvent.contextMenu(row('notes.txt'));

      fireEvent.keyDown(row('notes.txt').closest('li') as HTMLElement, { key: 'Escape' });

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

      fireEvent.click(screen.getByLabelText('New file'));

      // It arrives with its rename box open; Escape takes the offer back and leaves the row.
      fireEvent.keyDown(await within(tree).findByRole('textbox'), { key: 'Escape' });
      expect(within(tree).getByText('untitled.txt')).toBeInTheDocument();
      expect(createContent).toHaveBeenCalledWith('', 'file');
    });

    it('opens an empty name box on what it made, with the server name only as a placeholder', async () => {
      await renderBrowser();
      creates({ name: 'untitled-directory', path: 'untitled-directory', type: 'directory' });

      fireEvent.click(screen.getByLabelText('New folder'));

      const input = (await within(tree).findByRole('textbox')) as HTMLInputElement;
      // Empty, so the name is typed rather than typed over: `untitled-directory` is nobody's answer.
      expect(input.value).toBe('');
      expect(input.placeholder).toBe('untitled-directory');
      // And only that row: the rest of the tree is not waiting to be renamed.
      expect(within(tree).getAllByRole('textbox')).toHaveLength(1);
    });

    /** Creates through the toolbar and submits `typed` in the box that opens. */
    async function nameIt(button: string, typed: string) {
      fireEvent.click(screen.getByLabelText(button));
      const input = await within(tree).findByRole('textbox');
      fireEvent.change(input, { target: { value: typed } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }

    it('renames what it made to whatever is typed into the empty box', async () => {
      await renderBrowser();
      creates({ name: 'untitled.txt', path: 'untitled.txt', type: 'file' });

      await nameIt('New file', 'todo.txt');

      // The rename is against the name on disk, not against the empty box it was typed into.
      await waitFor(() =>
        expect(renameContent).toHaveBeenCalledWith('', 'untitled.txt', 'todo.txt')
      );
    });

    it('takes a file name exactly as typed, extension or none', async () => {
      await renderBrowser();
      creates({ name: 'untitled.txt', path: 'untitled.txt', type: 'file' });

      // Not `Makefile.txt`: the type it was created as is not a claim about what it is called.
      await nameIt('New file', 'Makefile');

      await waitFor(() =>
        expect(renameContent).toHaveBeenCalledWith('', 'untitled.txt', 'Makefile')
      );
    });

    it('ends a notebook in .ipynb even when the name typed does not', async () => {
      await renderBrowser();
      creates({ name: 'Untitled.ipynb', path: 'Untitled.ipynb', type: 'notebook' });

      // Nothing that opens a notebook, this editor included, knows one by anything but its extension.
      await nameIt('New notebook', 'analysis');

      await waitFor(() =>
        expect(renameContent).toHaveBeenCalledWith('', 'Untitled.ipynb', 'analysis.ipynb')
      );
    });

    it('does not double the extension a notebook name already has', async () => {
      await renderBrowser();
      creates({ name: 'Untitled.ipynb', path: 'Untitled.ipynb', type: 'notebook' });

      await nameIt('New notebook', 'analysis.ipynb');

      await waitFor(() =>
        expect(renameContent).toHaveBeenCalledWith('', 'Untitled.ipynb', 'analysis.ipynb')
      );
    });

    it('renames a notebook later to exactly what was asked for, extension and all', async () => {
      await renderBrowser();
      creates({ name: 'Untitled.ipynb', path: 'Untitled.ipynb', type: 'notebook' });
      fireEvent.click(screen.getByLabelText('New notebook'));
      fireEvent.keyDown(await within(tree).findByRole('textbox'), { key: 'Escape' });

      // An edit of a name that exists is not a naming: what is typed is what is meant, and the box
      // showed the extension it is dropping.
      openMenu('Untitled.ipynb', 'Rename');
      const input = within(tree).getByRole('textbox');
      fireEvent.change(input, { target: { value: 'notes' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() =>
        expect(renameContent).toHaveBeenCalledWith('', 'Untitled.ipynb', 'notes')
      );
    });

    it('says a name is required rather than renaming to nothing', async () => {
      await renderBrowser();
      creates({ name: 'untitled.txt', path: 'untitled.txt', type: 'file' });

      fireEvent.click(screen.getByLabelText('New file'));
      fireEvent.keyDown(await within(tree).findByRole('textbox'), { key: 'Enter' });

      expect(await screen.findByRole('alert')).toHaveTextContent('A name is required.');
      expect(renameContent).not.toHaveBeenCalled();
      // What the server made is still there under the name it gave it, waiting to be renamed again.
      expect(within(tree).getByText('untitled.txt')).toBeInTheDocument();
    });

    it('says why when the create fails', async () => {
      await renderBrowser();
      createContent.mockRejectedValue(
        new ApiError('POST', '/api/contents/create', 403, '{"message":"read-only file system"}')
      );

      fireEvent.click(screen.getByLabelText('New file'));

      expect(await screen.findByRole('alert')).toHaveTextContent('read-only file system');
    });

    it('creates a notebook at the root, which only the Launcher could do before', async () => {
      await renderBrowser();
      creates({ name: 'Untitled.ipynb', path: 'Untitled.ipynb', type: 'notebook' });

      fireEvent.click(screen.getByLabelText('New notebook'));

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
});
