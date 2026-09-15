import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchFile } from '@/api';
import { ApiError } from '@/api/client';
import { OpenDocument, useOpenDocument } from '@/store/openDocuments';
import { MatchReveal, revealMatchAtom } from '@/store/projectSearch';
import { fileTabsAtom } from '@/store/tabState';
import { Provider } from '@/testing/Provider';

import SearchPanel from './SearchPanel';

const searchContents = vi.fn();
const replaceInFiles = vi.fn();
const previewReplace = vi.fn();

vi.mock('@/api', async () => ({
  searchContents: (...args: unknown[]) => searchContents(...args),
  replaceInFiles: (...args: unknown[]) => replaceInFiles(...args),
  previewReplace: (...args: unknown[]) => previewReplace(...args),
  deleteKernel: vi.fn(),
  logApiError: () => () => {},
  apiErrorMessage: (await import('@/api/client')).apiErrorMessage,
}));

vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function files(replacement?: string): SearchFile[] {
  const with_ = replacement === undefined ? {} : { replacement };
  return [
    {
      path: 'src/prepare.py',
      kind: 'file',
      lines: [
        { line: 2, text: '    frame = load()', offset: 0, ranges: [{ from: 4, to: 9, ...with_ }] },
        {
          line: 3,
          text: 'frame = frame.dropna()',
          offset: 0,
          ranges: [
            { from: 0, to: 5, ...with_ },
            { from: 8, to: 13, ...with_ },
          ],
        },
      ],
    },
    {
      path: 'analysis.ipynb',
      kind: 'notebook',
      lines: [
        {
          line: 1,
          text: 'frame.head()',
          offset: 0,
          cell: 1,
          ranges: [{ from: 0, to: 5, ...with_ }],
        },
        {
          line: 1,
          text: 'frame has 20160 rows',
          offset: 0,
          cell: 1,
          output: true,
          ranges: [{ from: 0, to: 5, ...with_ }],
        },
      ],
    },
  ];
}

let seen: { tabs: string[]; active: string | undefined; reveal: MatchReveal | null };

function Probe() {
  const tabs = useAtomValue(fileTabsAtom);
  const reveal = useAtomValue(revealMatchAtom);
  seen = {
    tabs: Object.keys(tabs),
    active: Object.values(tabs).find((tab) => tab.active)?.path,
    reveal,
  };
  return null;
}

function OpenEditor({ path, document }: { path: string; document: OpenDocument }) {
  useOpenDocument(path, document);
  return null;
}

function renderPanel(extra?: React.ReactNode) {
  return render(
    <Provider>
      <SearchPanel hidden={false} />
      <Probe />
      {extra}
    </Provider>
  );
}

async function search(pattern: string) {
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: pattern } });
  await screen.findByText(/results? in/);
}

/** A match row, by the text of its line. */
function row(text: string): HTMLElement {
  const found = screen
    .getAllByRole('button')
    .find(
      (candidate) =>
        candidate.classList.contains('search-match') && candidate.textContent?.includes(text)
    );
  if (found === undefined) {
    throw new Error(`no row for ${text}`);
  }
  return found;
}

beforeEach(() => {
  searchContents.mockImplementation(
    async (query: { replace?: string }, onFile: (file: SearchFile) => void) => {
      files(query.replace).forEach(onFile);
      return { files: 2, matches: 5, capped: false };
    }
  );
  replaceInFiles.mockResolvedValue({ files: 1, replacements: 1, failed: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SearchPanel', () => {
  it('searches once the query stops changing, and lists the results by file', async () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'fr' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'frame' } });

    expect(await screen.findByRole('status')).toHaveTextContent('5 results in 2 files');
    expect(searchContents).toHaveBeenCalledTimes(1);
    expect(searchContents.mock.calls[0][0]).toEqual({
      pattern: 'frame',
      case_sensitive: false,
      whole_word: false,
      regexp: false,
      include: '',
      exclude: '',
    });
    expect(screen.getByText('prepare.py')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();
    // Indentation dropped, the match marked.
    expect(row('= load()').textContent).toBe('frame = load()');
    expect(within(row('= load()')).getByText('frame').tagName).toBe('MARK');
  });

  it('says what is wrong with a pattern the server refused', async () => {
    searchContents.mockRejectedValue(
      new ApiError(
        'POST',
        '/api/search',
        400,
        JSON.stringify({ message: 'Bad pattern: missing closing )' })
      )
    );
    renderPanel();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '(frame' } });

    expect(await screen.findByRole('status')).toHaveTextContent('Bad pattern: missing closing )');
  });

  it('opens a pressed match in its file, for the editor to put the cursor on', async () => {
    renderPanel();
    await search('frame');

    fireEvent.click(row('dropna'));

    expect(seen.active).toBe('src/prepare.py');
    expect(seen.reveal).toMatchObject({
      path: 'src/prepare.py',
      line: 3,
      from: 0,
      to: 5,
      search: 'frame',
    });
  });

  it('names a notebook match by its cell, and says an output cannot be replaced', async () => {
    renderPanel();
    await search('frame');
    fireEvent.click(screen.getByLabelText('Show replace'));

    expect(within(row('head()')).getByText('cell 2')).toBeInTheDocument();
    expect(within(row('20160')).getByText('output 2')).toBeInTheDocument();
    expect(within(row('20160')).queryByLabelText('Replace')).toBeNull();
    expect(
      screen.getByText('1 of these is in an output, and cannot be replaced.')
    ).toBeInTheDocument();
  });

  it("opens a file's diff for a pressed row while replacing, and the notebook itself for a notebook", async () => {
    renderPanel();
    await search('frame');
    fireEvent.click(screen.getByLabelText('Show replace'));

    fireEvent.click(row('dropna'));
    expect(seen.tabs).toContain('search-preview:src/prepare.py');

    fireEvent.click(row('head()'));
    expect(seen.active).toBe('analysis.ipynb');
    expect(seen.reveal).toMatchObject({ path: 'analysis.ipynb', cell: 1 });
  });

  it('writes a replace in an open editor there, and the rest on disk without what was left out', async () => {
    const applyEdits = vi.fn(() => ({ applied: 2, stale: 0 }));
    renderPanel(<OpenEditor path="src/prepare.py" document={{ applyEdits }} />);
    await search('frame');
    fireEvent.click(screen.getByLabelText('Show replace'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Replace' }), {
      target: { value: 'table' },
    });
    await waitFor(() => expect(within(row('= load()')).getByText('table').tagName).toBe('INS'));

    fireEvent.click(within(row('= load()')).getByLabelText('Leave this out'));
    expect(screen.getByRole('status')).toHaveTextContent('4 results in 2 files');

    await waitFor(() => expect(screen.getByText('Replace all')).toBeEnabled());
    fireEvent.click(screen.getByText('Replace all'));
    expect(screen.getByText('Replace 3 matches in 2 files?')).toBeInTheDocument();
    expect(
      screen.getByText('1 of the files is not open, so this cannot be undone from an editor.')
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Replace' }));
    });

    expect(applyEdits).toHaveBeenCalledWith([
      { cell: undefined, line: 3, from: 0, to: 5, expected: 'frame', insert: 'table' },
      { cell: undefined, line: 3, from: 8, to: 13, expected: 'frame', insert: 'table' },
    ]);
    expect(replaceInFiles).toHaveBeenCalledWith(expect.objectContaining({ replace: 'table' }), [
      { path: 'analysis.ipynb', skip: [] },
    ]);
  });
});
