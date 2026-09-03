import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileEditor from './FileEditor';
import { IfileTab } from '@/store/TabState';
import { unsavedTabsAtom } from '@/store/UnsavedState';

const getFileContent = vi.fn();
const saveFile = vi.fn();

vi.mock('@/api', () => ({
  getFileContent: (path: string) => getFileContent(path),
  saveFile: (path: string, content: string) => saveFile(path, content),
  logApiError: () => () => {},
}));

// CodeMirror cannot mount under jsdom, and the editor surface is not what this exercises.
vi.mock('@uiw/react-codemirror', async () => {
  const react = await import('react');
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: (props: any) =>
      react.createElement('textarea', {
        value: props.value,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange: (event: any) => props.onChange?.(event.target.value),
      }),
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
    getFileContent.mockResolvedValue('first line\n');
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
});
