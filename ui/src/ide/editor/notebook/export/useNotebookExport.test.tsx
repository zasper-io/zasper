import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotebookCell, NotebookModel } from '@/api';

import { useNotebookExport } from './useNotebookExport';

const saveAs = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();

vi.mock('@/browser', () => ({ saveAs: (...args: unknown[]) => saveAs(...args) }));
vi.mock('react-toastify', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}));

function cell(partial: Partial<NotebookCell>): NotebookCell {
  return {
    cell_type: 'code',
    id: 'c1',
    source: '',
    metadata: {},
    execution_count: null,
    outputs: [],
    reload: false,
    ...partial,
  };
}

const notebook: NotebookModel = {
  cells: [cell({ source: 'x = 1' })],
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
};

/**
 * The blob's text, which is what actually reached the file. Through FileReader rather than
 * `blob.text()`: jsdom's Blob does not implement it.
 */
function savedText(): Promise<string> {
  const blob = saveAs.mock.calls[0][0] as Blob;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function savedName(): string {
  return saveAs.mock.calls[0][1] as string;
}

function run(
  format: 'html' | 'markdown' | 'script',
  source: Partial<Parameters<typeof useNotebookExport>[0]> = {}
) {
  const { result } = renderHook(() =>
    useNotebookExport({ notebook, name: 'analysis.ipynb', ...source })
  );
  return act(() => result.current(format));
}

beforeEach(() => {
  saveAs.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  toastInfo.mockClear();
});

describe('useNotebookExport', () => {
  it('saves Markdown under the notebook’s own name', async () => {
    await run('markdown');

    expect(savedName()).toBe('analysis.md');
    await expect(savedText()).resolves.toContain('x = 1');
    expect(toastSuccess).toHaveBeenCalledWith('Exported analysis.md');
  });

  it('saves HTML as a whole document', async () => {
    await run('html');

    expect(savedName()).toBe('analysis.html');
    await expect(savedText()).resolves.toContain('<!doctype html>');
  });

  it("names a script from the attached kernel's language", async () => {
    await run('script', { kernelLanguage: 'julia' });

    expect(savedName()).toBe('analysis.jl');
  });

  it('falls back to Python for a notebook with no kernel attached', async () => {
    await run('script');

    expect(savedName()).toBe('analysis.py');
  });

  it('says so rather than handing over an empty file', async () => {
    const { result } = renderHook(() =>
      useNotebookExport({
        notebook: {
          cells: [cell({ source: '   ' })],
          nbformat: 4,
          nbformat_minor: 5,
          metadata: {},
        },
        name: 'empty.ipynb',
      })
    );

    await act(() => result.current('markdown'));

    expect(saveAs).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalled();
  });

  it('reports a failure instead of throwing at the press that caused it', async () => {
    const { result } = renderHook(() =>
      useNotebookExport({ notebook: null as unknown as NotebookModel, name: 'broken.ipynb' })
    );

    await expect(act(() => result.current('markdown'))).resolves.toBeUndefined();
    expect(saveAs).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });
});
