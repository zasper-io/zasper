import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileBrowser from './FileBrowser';
import { ApiError } from '@/api/client';
import {
  copyContent,
  deleteContent,
  getDirectory,
  moveContent,
  renameContent,
} from './fileBrowserFakes';
import {
  expandSrc,
  openMenu,
  openTabs,
  renderBrowser,
  row,
  setUpFileBrowser,
  tree,
} from './fileBrowserTestKit';

vi.mock('@/api', async () => (await import('./fileBrowserFakes')).apiModule());
vi.mock('@/browser', async () => (await import('./fileBrowserFakes')).browserModule());

describe('FileBrowser', () => {
  beforeEach(setUpFileBrowser);

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
      fireEvent.click(screen.getByLabelText('Refresh'));
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

    // The regression that closed the overlay family's dismissal rule. A row's dialog is rendered inside
    // the row, so Escape pressed in it reached the tree's own keyboard handler first, which cleared the
    // selection and then stopped the key: no keyboard could dismiss this dialog. Pressed *at the
    // dialog* and not at the window, because firing at the window is exactly what hid it.
    it('closes on Escape pressed inside it, which the tree used to swallow', async () => {
      await renderBrowser();
      openMenu('notes.txt', 'Delete');

      fireEvent.keyDown(screen.getByText('Cancel'), { key: 'Escape' });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(deleteContent).not.toHaveBeenCalled();
      expect(within(tree).getByText('notes.txt')).toBeInTheDocument();
    });

    it('warns that a folder takes everything inside it', async () => {
      await renderBrowser();

      openMenu('src', 'Delete Folder');

      expect(screen.getByRole('dialog')).toHaveTextContent('everything inside it');
    });
  });

  describe('the clipboard', () => {
    it('greys out Paste before anything has been cut or copied', async () => {
      await renderBrowser();

      fireEvent.contextMenu(row('src'));

      // Listed rather than hidden: a missing row only raises the question a disabled one answers.
      expect(screen.getByRole('menuitem', { name: 'Paste' })).toBeDisabled();
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
});
