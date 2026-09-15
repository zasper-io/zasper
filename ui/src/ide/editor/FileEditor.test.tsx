import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FileEditor from './FileEditor';
import { EditorSettings } from '@/api';
import { DEFAULT_EDITOR_SETTINGS, editorSettingsAtom } from '@/store/settings';
import { FileTab } from '@/store/tabState';
import { unsavedTabsAtom } from '@/store/unsavedState';
import { Provider as SeededProvider } from '@/testing/Provider';

const getFileContent = vi.fn();
const getEditorConfig = vi.fn();
const saveFile = vi.fn();
const downloadContent = vi.fn();
const saveAs = vi.fn();

vi.mock('@/api', () => ({
  getFileContent: (path: string) => getFileContent(path),
  getEditorConfig: (path: string) => getEditorConfig(path),
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

/**
 * CodeMirror cannot mount under jsdom, so this stands in for it: a textarea whose typing reaches the
 * editor as CodeMirror reports it, through onUpdate with the document, and a view whose document is
 * what the textarea holds, which is where the editor reads its text and applies a change from disk.
 */
vi.mock('@uiw/react-codemirror', async () => {
  const react = await import('react');
  const { Text } = await import('@codemirror/state');
  const documentOf = (value: string) => Text.of(value.split(/\r\n?|\n/));
  return {
    default: (props: any) => {
      const [mountedWith] = react.useState(props.value);
      const [value, setValue] = react.useState(props.value);
      const current = react.useRef(props.value);
      const latest = react.useRef(props);
      latest.current = props;
      const change = (next: string) => {
        current.current = next;
        setValue(next);
        latest.current.onUpdate?.({
          docChanged: true,
          state: { doc: documentOf(next), selection: { main: { head: 0 } } },
        });
      };
      react.useEffect(() => {
        latest.current.onCreateEditor?.({
          get state() {
            return { doc: documentOf(current.current) };
          },
          dispatch: ({ changes }: any) => {
            let text = current.current;
            // Highest position first, so each change is applied at the offset it was measured at.
            const edits = (Array.isArray(changes) ? [...changes] : [changes]).sort(
              (left, right) => right.from - left.from
            );
            for (const edit of edits) {
              text =
                text.slice(0, edit.from) + (edit.insert ?? '') + text.slice(edit.to ?? edit.from);
            }
            change(text);
          },
        });
      }, []);
      return react.createElement('textarea', {
        value,
        'data-mounted-with': mountedWith,
        onChange: (event: any) => change(event.target.value),
      });
    },
    Prec: { highest: (extension: unknown) => extension },
  };
});

// The watch socket, as the editor's listener: a test says when the project changed.
const watchers = vi.hoisted(() => ({ latest: () => {} }));
vi.mock('@/ide/useContentWatcher', () => ({
  useContentWatcher: (changed: () => void) => {
    watchers.latest = changed;
  },
}));

/** The project changed on disk, as the watch socket reports it. */
async function changedOnDisk(): Promise<void> {
  await act(async () => watchers.latest());
}

const tab: FileTab = {
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
    getEditorConfig.mockReset();
    getEditorConfig.mockResolvedValue({});
    saveFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('writes a file whose lines end in CRLF back with CRLF', async () => {
    getFileContent.mockResolvedValue(text('first line\r\n'));
    render(
      <Provider>
        <FileEditor data={tab} />
        <TabBar />
      </Provider>
    );
    await screen.findByRole('textbox');
    type('first line\nsecond line\n');
    await waitFor(() => expect(unsavedPaths()).toBe('notes.txt'));

    fireEvent.click(screen.getByText('save it'));

    await waitFor(() => expect(unsavedPaths()).toBe(''));
    expect(saveFile).toHaveBeenCalledWith('notes.txt', 'first line\r\nsecond line\r\n');
  });

  it('is saved again when the changes are undone by hand', async () => {
    await renderEditor();
    type('something else');
    await waitFor(() => expect(unsavedPaths()).toBe('notes.txt'));

    type('first line\n');

    await waitFor(() => expect(unsavedPaths()).toBe(''));
  });

  describe('when the file changes on disk', () => {
    it('takes the change into a file with nothing unsaved, and stays saved', async () => {
      await renderEditor();
      getFileContent.mockResolvedValue(text('first line\nwritten by git\n'));

      await changedOnDisk();

      await waitFor(() =>
        expect(screen.getByRole('textbox')).toHaveValue('first line\nwritten by git\n')
      );
      expect(unsavedPaths()).toBe('');
    });

    describe('under unsaved edits', () => {
      const BAND = 'notes.txt changed on disk.';

      async function editThenChangeOnDisk() {
        await renderEditor();
        type('first line\nmine\n');
        await waitFor(() => expect(unsavedPaths()).toBe('notes.txt'));
        getFileContent.mockResolvedValue(text('first line\ntheirs\n'));
        await changedOnDisk();
        await screen.findByText(BAND);
      }

      it('keeps the edits and says the file changed on disk', async () => {
        await editThenChangeOnDisk();

        expect(screen.getByRole('textbox')).toHaveValue('first line\nmine\n');
        expect(unsavedPaths()).toBe('notes.txt');
      });

      it('keeps mine unsaved, and does not ask again about the same change', async () => {
        await editThenChangeOnDisk();

        fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
        expect(screen.queryByText(BAND)).not.toBeInTheDocument();

        await changedOnDisk();
        await waitFor(() => expect(getFileContent).toHaveBeenCalledTimes(3));
        expect(screen.queryByText(BAND)).not.toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveValue('first line\nmine\n');
        expect(unsavedPaths()).toBe('notes.txt');
      });

      it('takes theirs, and is then saved', async () => {
        await editThenChangeOnDisk();

        fireEvent.click(screen.getByRole('button', { name: 'Take theirs' }));

        await waitFor(() =>
          expect(screen.getByRole('textbox')).toHaveValue('first line\ntheirs\n')
        );
        expect(unsavedPaths()).toBe('');
        expect(screen.queryByText(BAND)).not.toBeInTheDocument();
      });

      it('writes mine when saved while the band is up, and takes the band down', async () => {
        await editThenChangeOnDisk();

        fireEvent.click(screen.getByText('save it'));

        await waitFor(() => expect(unsavedPaths()).toBe(''));
        expect(saveFile).toHaveBeenCalledWith('notes.txt', 'first line\nmine\n');
        expect(screen.queryByText(BAND)).not.toBeInTheDocument();
      });

      it('asks nothing when the file on disk becomes what the editor holds', async () => {
        await renderEditor();
        type('first line\nsame\n');
        await waitFor(() => expect(unsavedPaths()).toBe('notes.txt'));
        getFileContent.mockResolvedValue(text('first line\nsame\n'));

        await changedOnDisk();

        await waitFor(() => expect(unsavedPaths()).toBe(''));
        expect(screen.queryByText(BAND)).not.toBeInTheDocument();
      });
    });

    it('does nothing when what is on disk is what it last read or saved', async () => {
      await renderEditor();
      type('first line\nsaved\n');
      fireEvent.click(screen.getByText('save it'));
      await waitFor(() => expect(unsavedPaths()).toBe(''));
      getFileContent.mockResolvedValue(text('first line\nsaved\n'));

      await changedOnDisk();

      expect(screen.getByRole('textbox')).toHaveValue('first line\nsaved\n');
    });

    it('waits until a background tab is shown before reading it again', async () => {
      const { rerender } = render(
        <Provider>
          <FileEditor data={{ ...tab, active: false }} />
          <TabBar />
        </Provider>
      );
      await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('first line\n'));
      getFileContent.mockClear();
      getFileContent.mockResolvedValue(text('first line\nwhile hidden\n'));

      await changedOnDisk();
      expect(getFileContent).not.toHaveBeenCalled();

      rerender(
        <Provider>
          <FileEditor data={{ ...tab, active: true, load_required: false }} />
          <TabBar />
        </Provider>
      );

      await waitFor(() =>
        expect(screen.getByRole('textbox')).toHaveValue('first line\nwhile hidden\n')
      );
    });
  });

  /*
   * What a save does to whitespace, and the save it makes by itself. Both are settings, so these render
   * with a store that has them on rather than the defaults.
   */
  describe('with the whitespace and autosave settings on', () => {
    const settings: EditorSettings = {
      ...DEFAULT_EDITOR_SETTINGS,
      trim_trailing_whitespace: true,
      insert_final_newline: true,
      auto_save: true,
    };

    async function renderWith(chosen: Partial<EditorSettings>) {
      render(
        <SeededProvider initialValues={[[editorSettingsAtom, { ...settings, ...chosen }]]}>
          <FileEditor data={tab} />
          <TabBar />
        </SeededProvider>
      );
      await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('first line\n'));
    }

    it('writes the file without the blanks at the ends of its lines', async () => {
      await renderWith({ auto_save: false });
      type('first line   \nsecond\t\n');
      await waitFor(() => expect(unsavedPaths()).toBe('notes.txt'));

      fireEvent.click(screen.getByText('save it'));

      await waitFor(() => expect(unsavedPaths()).toBe(''));
      expect(saveFile).toHaveBeenCalledWith('notes.txt', 'first line\nsecond\n');
      // What went to disk is what the editor holds, so the save does not leave the file unsaved.
      expect(screen.getByRole('textbox')).toHaveValue('first line\nsecond\n');
    });

    it('gives a file with no newline at its end one', async () => {
      await renderWith({ auto_save: false, trim_trailing_whitespace: false });
      type('first line\nno newline at the end');
      await waitFor(() => expect(unsavedPaths()).toBe('notes.txt'));

      fireEvent.click(screen.getByText('save it'));

      await waitFor(() =>
        expect(saveFile).toHaveBeenCalledWith('notes.txt', 'first line\nno newline at the end\n')
      );
    });

    it('leaves the whitespace alone when neither setting is on', async () => {
      await renderWith({
        auto_save: false,
        trim_trailing_whitespace: false,
        insert_final_newline: false,
      });
      type('first line   \nno newline');
      await waitFor(() => expect(unsavedPaths()).toBe('notes.txt'));

      fireEvent.click(screen.getByText('save it'));

      await waitFor(() =>
        expect(saveFile).toHaveBeenCalledWith('notes.txt', 'first line   \nno newline')
      );
    });

    it('saves by itself once the typing stops', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await renderWith({});
      type('first line\ntyped\n');

      // Still being typed into: the timer restarts on every change.
      await act(async () => vi.advanceTimersByTime(700));
      type('first line\ntyped some more\n');
      await act(async () => vi.advanceTimersByTime(700));
      expect(saveFile).not.toHaveBeenCalled();

      await act(async () => vi.advanceTimersByTime(400));
      await waitFor(() => expect(unsavedPaths()).toBe(''));
      expect(saveFile).toHaveBeenCalledWith('notes.txt', 'first line\ntyped some more\n');
    });

    // The band is a question, and a save is one of its answers: it is the reader's to give. The window
    // in which that can happen is the pause an autosave waits out, so the change on disk lands in it.
    it('does not save by itself while the file has changed on disk under the edits', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await renderWith({});
      type('first line\nmine\n');
      getFileContent.mockResolvedValue(text('first line\ntheirs\n'));

      await changedOnDisk();
      await screen.findByText('notes.txt changed on disk.');
      type('first line\nmine again\n');
      await act(async () => vi.advanceTimersByTime(3000));

      expect(saveFile).not.toHaveBeenCalled();
      expect(unsavedPaths()).toBe('notes.txt');
    });
  });

  it('offers no preview for a file that is not markdown', async () => {
    await renderEditor();

    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  describe('a markdown file', () => {
    const markdownTab: FileTab = { ...tab, path: 'notes.md', name: 'notes.md', extension: 'md' };

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
