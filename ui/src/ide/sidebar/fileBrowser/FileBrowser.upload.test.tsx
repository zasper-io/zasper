import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileBrowser from './FileBrowser';
import { ApiError } from '@/api/client';
import { getDirectory, uploadFile } from './fileBrowserFakes';
import { openMenu, renderBrowser, row, setUpFileBrowser, tree } from './fileBrowserTestKit';

vi.mock('@/api', async () => (await import('./fileBrowserFakes')).apiModule());
vi.mock('@/browser', async () => (await import('./fileBrowserFakes')).browserModule());

describe('FileBrowser', () => {
  beforeEach(setUpFileBrowser);

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
});
