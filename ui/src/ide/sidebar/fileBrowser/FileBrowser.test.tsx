import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileBrowser from './FileBrowser';
import { ApiError } from '@/api/client';
import { ROW_TOOLTIP_DELAY_MS } from './entryDetails';
import { createContent, getDirectory } from './fileBrowserFakes';
import {
  expandSrc,
  openMenu,
  openTabs,
  renderBrowser,
  rootListing,
  row,
  rowTooltip,
  setUpFileBrowser,
  srcListing,
  tree,
} from './fileBrowserTestKit';

vi.mock('@/api', async () => (await import('./fileBrowserFakes')).apiModule());
vi.mock('@/browser', async () => (await import('./fileBrowserFakes')).browserModule());

describe('FileBrowser', () => {
  beforeEach(setUpFileBrowser);

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

      fireEvent.click(screen.getByLabelText('Refresh'));

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

      fireEvent.click(screen.getByLabelText('Refresh'));

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

      fireEvent.click(screen.getByLabelText('Refresh'));

      expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
    });

    it('leaves the tree alone when the server cannot be reached at all', async () => {
      await renderBrowser();
      await expandSrc();
      getDirectory.mockRejectedValue(new TypeError('Failed to fetch'));

      fireEvent.click(screen.getByLabelText('Refresh'));

      await screen.findByRole('alert');
      // Nothing has been deleted; there is only nobody to ask. Closing every open folder over a
      // server restart is the wrong answer to that.
      expect(within(tree).getByText('main.py')).toBeInTheDocument();
    });

    it('takes the message down once the tree reads again', async () => {
      await renderBrowser();
      getDirectory.mockRejectedValue(new ApiError('POST', '/api/contents', 503, ''));
      fireEvent.click(screen.getByLabelText('Refresh'));
      await screen.findByRole('alert');

      // The server came back — by itself, as far as the panel is concerned.
      getDirectory.mockImplementation(() => Promise.resolve(rootListing));
      fireEvent.click(screen.getByLabelText('Refresh'));

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
      expect(within(trail()).getByText('src')).toHaveAttribute('aria-current', 'location');

      // The project's own crumb, which carries the project name and has none in a test. Its full
      // path is the tooltip now rather than a `title`, so the way to it is the trail's first button.
      fireEvent.click(within(trail()).getAllByRole('button')[0]);

      expect(await within(tree).findByText('notes.txt')).toBeInTheDocument();
      expect(within(trail()).queryByText('src')).not.toBeInTheDocument();
    });

    it('creates into the folder in view rather than the project root', async () => {
      await renderBrowser();
      await rootAtSrc();

      fireEvent.click(screen.getByLabelText('New file'));

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

      fireEvent.click(screen.getByLabelText('Refresh'));

      // A view of a folder that is not there has nothing in it and no way out of it.
      expect(await within(tree).findByText('notes.txt')).toBeInTheDocument();
      expect(within(trail()).queryByText('src')).not.toBeInTheDocument();
    });
  });

  describe('what the tree shows', () => {
    it('keeps dotfiles out of the way until they are asked for', async () => {
      await renderBrowser();
      expect(within(tree).queryByText('.env')).not.toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Show hidden files'));

      expect(within(tree).getByText('.env')).toBeInTheDocument();
    });

    it('dims what git would not track, and says so in the tooltip', async () => {
      await renderBrowser();

      // Dimmed rather than hidden: build output is still worth opening.
      expect(row('build.log')).toHaveClass('is-ignored');
      expect(rowTooltip('build.log')).toContain('ignored by git');
    });

    it('marks a row that cannot be written', async () => {
      await renderBrowser();

      expect(within(row('build.log')).getByLabelText('Read-only')).toBeInTheDocument();
      expect(row('notes.txt').querySelector('.rowFlag')).toBeNull();
    });

    it('puts the size and the date the server already sent in the tooltip', async () => {
      await renderBrowser();

      expect(rowTooltip('build.log')).toContain('2 kB');
      expect(rowTooltip('build.log')).toContain('build.log');
    });

    it('labels only the row under the pointer, not every folder it sits in', async () => {
      // A folder's `li` holds its children, so a pointer resting on a file inside it used to arrive on
      // every ancestor as well and stack up a tooltip per level.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await renderBrowser();
        await expandSrc();

        fireEvent.pointerEnter(row('main.py'));
        await act(async () => {
          vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS);
        });

        expect(screen.getAllByRole('tooltip')).toHaveLength(1);
        expect(screen.getByRole('tooltip').textContent).toContain('src/main.py');
      } finally {
        vi.useRealTimers();
      }
    });

    // Stillness, not time since arriving: a pointer crossing the tree is not asking about the rows it
    // crosses, and the box it would open covers the ones below. The moves below are a second apart,
    // inside a wait of two, so each one starts it again.
    it('waits for the pointer to stop, and starts again every time it moves', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await renderBrowser();
        await expandSrc();

        fireEvent.pointerEnter(row('main.py'));
        // Three seconds of moving inside the row, a second apart: nothing opens, because the wait
        // is never more than a second old.
        for (let second = 0; second < 3; second++) {
          fireEvent.pointerMove(row('main.py'));
          await act(async () => {
            vi.advanceTimersByTime(1000);
          });
          expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        }

        await act(async () => {
          vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS);
        });
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    // A path in a 240px box is three lines of broken text; the box is fixed-position on the menu
    // layer, so one line runs over the editor instead, where nothing is being aimed at.
    it('says it in one line, whatever the path costs', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await renderBrowser();
        await expandSrc();

        fireEvent.pointerEnter(row('main.py'));
        await act(async () => {
          vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS);
        });

        expect(screen.getByRole('tooltip')).toHaveClass('z-tooltip-oneline');
      } finally {
        vi.useRealTimers();
      }
    });

    it("puts an expanded folder's tooltip under its row rather than under its children", async () => {
      await renderBrowser();
      await expandSrc();
      const link = row('src');
      const item = link.closest('li') as HTMLElement;
      link.getBoundingClientRect = () => new DOMRect(5, 10, 100, 20);
      item.getBoundingClientRect = () => new DOMRect(5, 10, 100, 400);

      fireEvent.focus(item);

      // The row's bottom edge plus the 4px gap, not the subtree's.
      expect(screen.getByRole('tooltip')).toHaveStyle({ top: '34px' });
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
});
