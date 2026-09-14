import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileEditor from './FileEditor';
import { IfileTab } from '@/store/TabState';
import { unsavedTabsAtom } from '@/store/UnsavedState';

const getFileContent = vi.fn();
const saveFile = vi.fn();
const downloadContent = vi.fn();
const saveAs = vi.fn();

vi.mock('@/api', () => ({
  getFileContent: (path: string) => getFileContent(path),
  saveFile: (path: string, content: string) => saveFile(path, content),
  downloadContent: (path: string) => downloadContent(path),
  logApiError: () => () => {},
  apiErrorMessage: (error: unknown) => (error as Error).message,
}));

vi.mock('@/browser', () => ({
  saveAs: (blob: Blob, filename: string) => saveAs(blob, filename),
}));

function text(content: string) {
  return { format: 'text', content, mimetype: 'text/plain' };
}

// CodeMirror cannot mount under jsdom, and the editor surface is not what this exercises.
vi.mock('@uiw/react-codemirror', async () => {
  const react = await import('react');
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: (props: any) => {
      const [mountedWith] = react.useState(props.value);
      return react.createElement('textarea', {
        value: props.value,
        'data-mounted-with': mountedWith,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange: (event: any) => props.onChange?.(event.target.value),
      });
    },
    Prec: { highest: (extension: unknown) => extension },
  };
});

const tab: IfileTab = {
  type: 'file',
  path: 'notes.txt',
  name: 'notes.txt',
  active: true,
  extension: 'txt',
  load_required: true,
  kernelspec: 'none',
};

/** Stands in for the tab bar: it can see which tabs are unsaved and save one, and nothing else. */
function TabBar() {
  const unsavedTabs = useAtomValue(unsavedTabsAtom);
  return (
    <div>
      <span data-testid="unsaved">{Object.keys(unsavedTabs).join(',')}</span>
      <button type="button" onClick={() => unsavedTabs['notes.txt']?.()}>
        save it
      </button>
    </div>
  );
}

/** The paths the tab bar would prompt about before closing. */
function unsavedPaths(): string {
  return screen.getByTestId('unsaved').textContent ?? '';
}

function type(text: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
}

describe('FileEditor', () => {
  beforeEach(() => {
    getFileContent.mockReset();
    saveFile.mockReset();
    downloadContent.mockReset();
    saveAs.mockReset();
    getFileContent.mockResolvedValue(text('first line\n'));
    saveFile.mockResolvedValue(undefined);
  });

  async function renderEditor() {
    render(
      <Provider>
        <FileEditor data={tab} />
        <TabBar />
      </Provider>
    );
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('first line\n'));
  }

  it('holds nothing unsaved when the file has only just been read', async () => {
    await renderEditor();

    expect(unsavedPaths()).toBe('');
  });

  // The real editor records text handed to it after mounting as an edit, which Mod-z then undoes.
  it('mounts the editor with the file already in it, so undo cannot empty it', async () => {
    await renderEditor();

    expect(screen.getByRole('textbox')).toHaveAttribute('data-mounted-with', 'first line\n');
  });

  it('is unsaved as soon as it is typed into', async () => {
    await renderEditor();

    type('first line\nsecond line\n');

    await waitFor(() => expect(unsavedPaths()).toBe('notes.txt'));
  });

  it('writes what the editor holds when the tab bar saves it, and is saved again after', async () => {
    await renderEditor();
    type('first line\nsecond line\n');
    await waitFor(() => expect(unsavedPaths()).toBe('notes.txt'));

    fireEvent.click(screen.getByText('save it'));

    await waitFor(() => expect(unsavedPaths()).toBe(''));
    expect(saveFile).toHaveBeenCalledWith('notes.txt', 'first line\nsecond line\n');
  });

  it('is saved again when the changes are undone by hand', async () => {
    await renderEditor();
    type('something else');
    await waitFor(() => expect(unsavedPaths()).toBe('notes.txt'));

    type('first line\n');

    await waitFor(() => expect(unsavedPaths()).toBe(''));
  });

  it('offers no preview for a file that is not markdown', async () => {
    await renderEditor();

    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  describe('a markdown file', () => {
    const markdownTab: IfileTab = { ...tab, path: 'notes.md', name: 'notes.md', extension: 'md' };

    beforeEach(() => {
      getFileContent.mockResolvedValue(text('# Title\n'));
    });

    async function renderMarkdown() {
      render(
        <Provider>
          <FileEditor data={markdownTab} />
        </Provider>
      );
      await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('# Title\n'));
    }

    function source(): Element | null {
      return screen.getByRole('textbox').closest('.file-editor-body');
    }

    it('opens as text', async () => {
      await renderMarkdown();

      expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('shows only the rendering in preview, keeping the editor mounted', async () => {
      await renderMarkdown();

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

      expect(await screen.findByRole('heading', { name: 'Title' })).toBeInTheDocument();
      expect(source()).toHaveClass('is-hidden');
    });

    it('shows both side by side, rendering unsaved edits', async () => {
      await renderMarkdown();

      fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
      await screen.findByRole('heading', { name: 'Title' });
      expect(source()).not.toHaveClass('is-hidden');

      type('# Renamed\n');

      expect(await screen.findByRole('heading', { name: 'Renamed' })).toBeInTheDocument();
    });
  });

  // Shown as its bytes decoded, a Latin-1 or binary file was written back changed on the next save.
  describe('a file that is not text', () => {
    beforeEach(() => {
      getFileContent.mockResolvedValue({
        format: 'base64',
        content: 'Y2Fm6Qo=',
        mimetype: 'application/octet-stream',
      });
    });

    async function renderNotText() {
      render(
        <Provider>
          <FileEditor data={tab} />
          <TabBar />
        </Provider>
      );
      await screen.findByText('notes.txt is not a text file.');
    }

    it('says so instead of offering an editor', async () => {
      await renderNotText();

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('holds nothing the tab bar could save back over the file', async () => {
      await renderNotText();

      expect(unsavedPaths()).toBe('');
      expect(saveFile).not.toHaveBeenCalled();
    });

    it('offers the file as a download', async () => {
      const bytes = new Blob(['caf\xe9\n']);
      downloadContent.mockResolvedValue(bytes);
      await renderNotText();

      fireEvent.click(screen.getByRole('button', { name: 'Download' }));

      await waitFor(() => expect(saveAs).toHaveBeenCalledWith(bytes, 'notes.txt'));
      expect(downloadContent).toHaveBeenCalledWith('notes.txt');
    });
  });

  /*
   * A tab restored from a previous visit can name a file that has since been deleted. What used to
   * happen: the read rejected unhandled, the editor stood there looking like an empty file, and
   * saving it wrote the deleted file back to disk.
   */
  describe('when the file cannot be read', () => {
    beforeEach(() => {
      getFileContent.mockImplementation(() =>
        Promise.reject(new Error('file not found: notes.txt'))
      );
    });

    async function renderFailed() {
      render(
        <Provider>
          <FileEditor data={tab} />
          <TabBar />
        </Provider>
      );
      await screen.findByRole('alert');
    }

    it('says so instead of offering an editor', async () => {
      await renderFailed();

      expect(screen.getByRole('alert')).toHaveTextContent('file not found: notes.txt');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('holds nothing the tab bar could save back over the file', async () => {
      await renderFailed();

      expect(unsavedPaths()).toBe('');
      expect(saveFile).not.toHaveBeenCalled();
    });
  });
});
