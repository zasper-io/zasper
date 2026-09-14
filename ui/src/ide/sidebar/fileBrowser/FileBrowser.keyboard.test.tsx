import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileBrowser from './FileBrowser';
import { moveContent } from './fileBrowserFakes';
import {
  expandSrc,
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
