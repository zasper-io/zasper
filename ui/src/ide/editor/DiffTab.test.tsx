import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorState } from '@codemirror/state';

import DiffTab from './DiffTab';
import type { DiffTarget } from '@/api';
import { IfileTab } from '@/store/TabState';

const getDiff = vi.fn();

vi.mock('@/api', () => ({
  getDiff: (target: unknown) => getDiff(target),
  apiErrorMessage: (error: unknown) => (error as Error).message,
}));

/** Every merge view built, in the order they were built. */
const views: {
  a: { doc: string; extensions: unknown };
  b: { doc: string; extensions: unknown };
}[] = [];
const destroyed = vi.fn();

// A MergeView cannot mount under jsdom, and what matters here is which two documents it was handed
// and on what terms — not how CodeMirror draws them.
vi.mock('@codemirror/merge', () => ({
  MergeView: class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(config: any) {
      views.push(config);
    }
    destroy() {
      destroyed();
    }
  },
}));

const documents = {
  path: 'src/notes.txt',
  original: 'one\n',
  modified: 'two\n',
  isBinary: false,
  isNotebook: false,
  tooLarge: false,
};

const tab: IfileTab = {
  type: 'diff',
  path: 'diff:worktree:src/notes.txt',
  name: 'notes.txt (diff)',
  active: true,
  extension: 'txt',
  load_required: true,
  kernelspec: 'none',
};

function renderDiff(target: DiffTarget = { path: 'src/notes.txt' }) {
  return render(
    <Provider>
      <DiffTab data={tab} target={target} />
    </Provider>
  );
}

/** Whether an editor built from one side of the last view would refuse to be typed into. */
function readOnly(side: 'a' | 'b'): boolean {
  const config = views[views.length - 1][side];
  return EditorState.create({
    doc: config.doc,
    extensions: config.extensions as [],
  }).readOnly;
}

describe('DiffTab', () => {
  beforeEach(() => {
    views.length = 0;
    getDiff.mockReset();
    destroyed.mockReset();
    getDiff.mockResolvedValue(documents);
  });

  it('shows the two documents the server sent, and neither of them as writable', async () => {
    renderDiff();

    await waitFor(() => expect(views).toHaveLength(1));
    expect(getDiff).toHaveBeenCalledWith({
      path: 'src/notes.txt',
      staged: undefined,
      ref: undefined,
      from: undefined,
    });
    expect(views[0].a.doc).toBe('one\n');
    expect(views[0].b.doc).toBe('two\n');
    // Editing one side of a diff means writing to the index or to a commit. Neither is something an
    // editor can do, so neither side pretends it can.
    expect(readOnly('a')).toBe(true);
    expect(readOnly('b')).toBe(true);
  });

  it('says which two versions are on screen', async () => {
    renderDiff();

    // The unstaged comparison is what a commit would leave behind, and saying "before / after" about it
    // leaves out that one of the two is a file on disk.
    expect(await screen.findByText('Index')).toBeInTheDocument();
    expect(screen.getByText('Working tree')).toBeInTheDocument();
  });

  it('names the commit a comparison against one is about', async () => {
    renderDiff({ path: 'src/notes.txt', ref: 'abc1234def5678' });

    expect(await screen.findByText('abc1234')).toBeInTheDocument();
    expect(screen.getByText('Parent of abc1234')).toBeInTheDocument();
  });

  it('says a notebook diff is of the code and not of the file', async () => {
    getDiff.mockResolvedValue({ ...documents, path: 'analysis.ipynb', isNotebook: true });
    renderDiff({ path: 'analysis.ipynb' });

    // Otherwise a diff with no outputs in it reads as a notebook whose outputs were all deleted.
    expect(await screen.findByText(/Cell sources only/)).toBeInTheDocument();
  });

  it('draws nothing for a binary file, and says why', async () => {
    getDiff.mockResolvedValue({ ...documents, original: '', modified: '', isBinary: true });
    renderDiff({ path: 'logo.png' });

    expect(await screen.findByText(/binary file/)).toBeInTheDocument();
    // Two empty columns with a "no changes" note under them would say the file had not changed.
    expect(views).toHaveLength(0);
    expect(screen.queryByText('No changes.')).not.toBeInTheDocument();
  });

  it('reports a comparison the server would not make', async () => {
    getDiff.mockRejectedValue(new Error('"gone.txt" is on neither side of this comparison'));
    renderDiff({ path: 'gone.txt' });

    // The ordinary way to get here is a row clicked after the file behind it was committed or discarded
    // in a terminal, and the server's own sentence about it says more than an empty diff.
    expect(await screen.findByText(/neither side/)).toBeInTheDocument();
    expect(views).toHaveLength(0);
  });

  it('re-reads when asked, and throws away the view it had', async () => {
    renderDiff();
    await waitFor(() => expect(views).toHaveLength(1));

    getDiff.mockResolvedValue({ ...documents, modified: 'three\n' });
    fireEvent.click(screen.getByLabelText('Refresh'));

    // A diff is true as of when it was read, and the file it is about is one someone is still editing.
    await waitFor(() => expect(views).toHaveLength(2));
    expect(views[1].b.doc).toBe('three\n');
    expect(destroyed).toHaveBeenCalledTimes(1);
  });
});
