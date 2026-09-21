import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Palette from './Palette';
import { ContentEntry } from '@/api';
import { Command } from '@/commands/types';
import { goToLineAtom } from '@/store/editorRequests';
import { FileFormat, fileFormatsAtom } from '@/store/editorStatus';
import { recentFilesAtom } from '@/store/recentFiles';
import { FileTab, fileTabsAtom } from '@/store/tabState';
import { Provider as SeededProvider } from '@/testing/Provider';
import { Provider, useAtomValue } from 'jotai';

const searchFiles = vi.fn();
const documentSymbols = vi.fn();
const workspaceSymbols = vi.fn();

// useTabActions reaches for the first two; nothing here makes it kill a kernel, but a name the mock
// does not define is an error the moment anything touches it.
vi.mock('@/api', () => ({
  searchFiles: (query: string) => searchFiles(query),
  deleteKernel: vi.fn(),
  logApiError: () => () => {},
}));

// The symbol halves of the query ask a language server, which no test here runs.
vi.mock('@/lsp/symbols', () => ({
  documentSymbols: (...args: unknown[]) => documentSymbols(...args),
  workspaceSymbols: (query: string) => workspaceSymbols(query),
  kindGlyph: () => 'ƒ',
}));
vi.mock('@/lsp/views', () => ({ editorViewFor: () => ({}) }));

function command(overrides: Partial<Command>): Command {
  return {
    id: 'test',
    label: 'Test',
    category: 'File',
    scope: 'app',
    execute: vi.fn(),
    ...overrides,
  };
}

function entry(path: string): ContentEntry {
  return { type: 'file', path, name: path.split('/').pop() ?? path, content: [] };
}

/** The tabs the palette opened, so a click on a file row can be checked against the store. */
function OpenTabs() {
  return <div data-testid="tabs">{Object.keys(useAtomValue(fileTabsAtom)).join(',')}</div>;
}

// Its own store per render, so the tabs one test opens are not the tabs the next one reads.
function renderPalette(props: Partial<React.ComponentProps<typeof Palette>> = {}) {
  return render(
    <Provider>
      <Palette commands={mockCommands} initialQuery="" onClose={vi.fn()} {...props} />
      <OpenTabs />
    </Provider>
  );
}

/** The palette's own list, so a query cannot match the probes rendered beside it. */
function list(): HTMLElement {
  return document.querySelector('.palette-list') as HTMLElement;
}

/** The field, which is also the widget: everything below is typed into it. */
function input(): HTMLElement {
  return screen.getByPlaceholderText('Search files, > for commands, @ for symbols');
}

/** A file open in front of the palette, as the file editor leaves it: a tab, and a format for it. */
const openTab: FileTab = {
  type: 'file',
  path: 'prepare.py',
  name: 'prepare.py',
  active: true,
  extension: 'py',
  load_required: false,
  kernelspec: 'none',
};

const format: FileFormat = {
  indentWithTabs: false,
  tabSize: 4,
  eol: 'LF',
  detected: null,
  source: 'settings',
  trim: null,
  finalNewline: null,
};

/** The line the palette asked the editor for. */
function LineRequest() {
  return <div data-testid="line">{String(useAtomValue(goToLineAtom))}</div>;
}

/** The palette over a project with a file open and two files opened earlier. */
function renderOverEditor(onClose = vi.fn()) {
  render(
    <SeededProvider
      initialValues={[
        [fileTabsAtom, { 'prepare.py': openTab }],
        [fileFormatsAtom, { 'prepare.py': format }],
        [
          recentFilesAtom,
          [
            { path: 'lib/clean.py', name: 'clean.py', type: 'file' },
            { path: 'prepare.py', name: 'prepare.py', type: 'file' },
          ],
        ],
      ]}
    >
      <Palette commands={mockCommands} initialQuery="" onClose={onClose} />
      <OpenTabs />
      <LineRequest />
    </SeededProvider>
  );
  return onClose;
}

let mockCommands: Command[];

beforeEach(() => {
  mockCommands = [
    command({ id: 'file:open', label: 'Open File', description: 'Open a file in the editor' }),
    command({ id: 'file:save', label: 'Save File', description: 'Save the current file' }),
    command({ id: 'file:close', label: 'Close File', description: 'Close the current file' }),
  ];
  searchFiles.mockReset();
  searchFiles.mockResolvedValue([]);
});

describe('Palette', () => {
  it('renders the field', () => {
    renderPalette();
    expect(input()).toBeInTheDocument();
  });

  it('narrows the commands to those matching the query', () => {
    renderPalette();
    fireEvent.change(input(), { target: { value: 'save' } });
    expect(screen.getByText('Save File')).toBeInTheDocument();
    expect(screen.queryAllByText(/^(Open|Close) File$/)).toHaveLength(0);
  });

  // So that "notebook" finds the notebook's commands without knowing what any of them is called.
  it('filters on the category too', () => {
    renderPalette({
      commands: [...mockCommands, command({ id: 'nb:run', label: 'Run', category: 'Notebook' })],
    });
    fireEvent.change(input(), { target: { value: 'notebook' } });
    expect(screen.getByText('Run')).toBeInTheDocument();
    expect(screen.queryByText('Open File')).not.toBeInTheDocument();
  });

  it('handles keyboard navigation', () => {
    renderPalette({ initialQuery: '>' });
    // The first match is selected on open, so Enter alone runs it.
    expect(screen.getByText('Open File').parentElement).toHaveClass('is-selected');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getByText('Save File').parentElement).toHaveClass('is-selected');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getByText('Open File').parentElement).toHaveClass('is-selected');
  });

  it('runs the command the arrow keys reached on Enter, then closes', () => {
    const onClose = vi.fn();
    renderPalette({ initialQuery: '>', onClose });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(mockCommands[1].execute).toHaveBeenCalledOnce();
    expect(mockCommands[0].execute).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('runs nothing on Enter when the query matches nothing', () => {
    const onClose = vi.fn();
    renderPalette({ onClose });
    fireEvent.change(input(), { target: { value: 'no such command' } });
    fireEvent.keyDown(input(), { key: 'Enter' });

    for (const registered of mockCommands) {
      expect(registered.execute).not.toHaveBeenCalled();
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it('runs a clicked command, then closes', () => {
    const onClose = vi.fn();
    renderPalette({ initialQuery: '>', onClose });
    fireEvent.click(screen.getByText('Close File'));
    expect(mockCommands[2].execute).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows a disabled command but refuses to run it', () => {
    const onClose = vi.fn();
    const disabled = command({ id: 'nb:restart', label: 'Restart Kernel', isEnabled: () => false });
    renderPalette({ commands: [disabled], initialQuery: '>', onClose });

    expect(screen.getByText('Restart Kernel').parentElement).toHaveClass('is-disabled');
    fireEvent.click(screen.getByText('Restart Kernel'));

    expect(disabled.execute).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the keybinding, and only shows one when the spellings collapse', () => {
    renderPalette({
      commands: [command({ keys: ['Mod-Shift-p', 'Ctrl-Shift-p'] })],
      initialQuery: '>',
    });

    // ⌘⇧P plus ⌃⇧P on mac; the two are one chord elsewhere.
    const shown = screen.getByText(/⇧P|Shift\+P/);
    expect(shown.textContent?.match(/P/g)).toHaveLength(navigator.platform.includes('Mac') ? 2 : 1);
  });

  // A query typed after arrowing down can leave the selection past the end of the shorter list.
  it('does not keep a selection the filtered list no longer has', () => {
    renderPalette({ initialQuery: '>' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });

    fireEvent.change(input(), { target: { value: '>Open' } });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(mockCommands[0].execute).toHaveBeenCalled();
    expect(mockCommands[2].execute).not.toHaveBeenCalled();
  });

  // The whole point of the merge: one query, and both kinds of answer to it.
  it('lists matching commands and matching files together', async () => {
    searchFiles.mockResolvedValue([entry('src/open.py')]);
    renderPalette();
    fireEvent.change(input(), { target: { value: 'open' } });

    expect(await screen.findByText('open.py')).toBeInTheDocument();
    expect(screen.getByText('src/open.py')).toBeInTheDocument();
    expect(screen.getByText('Open File')).toBeInTheDocument();
    expect(screen.getByText('Commands')).toBeInTheDocument();
    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  it('opens a file on click', async () => {
    const onClose = vi.fn();
    searchFiles.mockResolvedValue([entry('src/open.py')]);
    renderPalette({ onClose });
    fireEvent.change(input(), { target: { value: 'open' } });

    fireEvent.click(await screen.findByText('open.py'));
    expect(screen.getByTestId('tabs')).toHaveTextContent('src/open.py');
    expect(onClose).toHaveBeenCalled();
  });

  it('runs the file the arrow keys reached, not the command above it', async () => {
    searchFiles.mockResolvedValue([entry('src/open.py')]);
    renderPalette();
    fireEvent.change(input(), { target: { value: 'open' } });
    await screen.findByText('open.py');

    // One command matches 'open', so the second row is the file.
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(mockCommands[0].execute).not.toHaveBeenCalled();
    expect(screen.getByTestId('tabs')).toHaveTextContent('src/open.py');
  });

  // Muscle memory from the palette this replaced, and the way to see the whole registry.
  it('leaves the files out when the query starts with >', async () => {
    renderPalette({ initialQuery: '>' });
    expect(screen.getByText('Open File')).toBeInTheDocument();
    expect(screen.getByText('Close File')).toBeInTheDocument();
    expect(screen.queryByText('Files')).not.toBeInTheDocument();

    fireEvent.change(input(), { target: { value: '>open' } });
    await waitFor(() => expect(screen.queryByText('Save File')).not.toBeInTheDocument());
    expect(searchFiles).not.toHaveBeenCalled();
  });

  // An empty query from the search box is a question not yet asked, not a request for everything.
  it('lists nothing at all until something is typed', () => {
    renderPalette();
    expect(screen.queryByText('Open File')).not.toBeInTheDocument();
    expect(screen.queryByText('Commands')).not.toBeInTheDocument();
    expect(searchFiles).not.toHaveBeenCalled();
  });

  it('caps each section, and says how many matches are behind it', async () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      command({ id: `file:many-${index}`, label: `Open Thing ${index}` })
    );
    searchFiles.mockResolvedValue(Array.from({ length: 8 }, (_, i) => entry(`src/open-${i}.py`)));
    renderPalette({ commands: many });
    fireEvent.change(input(), { target: { value: 'open' } });

    await screen.findByText('open-0.py');
    expect(screen.getByText('6 of 9')).toBeInTheDocument();
    expect(screen.getByText('6 of 8')).toBeInTheDocument();
    expect(screen.getAllByText(/^Open Thing/)).toHaveLength(6);
    expect(screen.queryByText('open-6.py')).not.toBeInTheDocument();
  });

  it('keeps the list rather than emptying it when the search fails', async () => {
    searchFiles.mockRejectedValue(new Error('nope'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPalette();
    fireEvent.change(input(), { target: { value: 'open' } });

    await waitFor(() => expect(logged).toHaveBeenCalled());
    // The commands still answered the query, so the palette is not empty.
    expect(screen.getByText('Open File')).toBeInTheDocument();
    logged.mockRestore();
  });
});

describe('Palette, over a file', () => {
  beforeEach(() => {
    searchFiles.mockReset();
    searchFiles.mockResolvedValue([]);
    mockCommands = [command({ id: 'file:save', label: 'Save File' })];
  });

  it('asks the editor for a line typed after a colon', () => {
    const onClose = renderOverEditor();

    fireEvent.change(input(), { target: { value: ':42' } });
    expect(within(list()).getByText('prepare.py')).toBeInTheDocument();
    fireEvent.click(within(list()).getByText('Go to line 42'));

    expect(screen.getByTestId('line')).toHaveTextContent('42');
    expect(onClose).toHaveBeenCalled();
  });

  // A colon is not a file name either, so the list is empty rather than full of near misses.
  it('offers nothing for a colon with no number after it', () => {
    renderOverEditor();

    fireEvent.change(input(), { target: { value: ':chapter' } });

    expect(screen.queryByText(/Go to line/)).not.toBeInTheDocument();
    expect(screen.queryByText('Save File')).not.toBeInTheDocument();
  });

  it('lists the files this project had open when nothing has been typed', () => {
    renderOverEditor();

    expect(within(list()).getByText('Recent')).toBeInTheDocument();
    expect(within(list()).getByText('clean.py')).toBeInTheDocument();
    expect(within(list()).getByText('lib')).toBeInTheDocument();
    // prepare.py is still open, and a tab away.
    expect(within(list()).queryByText('prepare.py')).not.toBeInTheDocument();
  });

  it('opens a recent file, and closes', () => {
    const onClose = renderOverEditor();

    fireEvent.click(within(list()).getByText('clean.py'));

    expect(screen.getByTestId('tabs')).toHaveTextContent('lib/clean.py');
    expect(onClose).toHaveBeenCalled();
  });

  it('drops the recent files as soon as something is typed', () => {
    renderOverEditor();

    fireEvent.change(input(), { target: { value: 'save' } });

    expect(within(list()).queryByText('Recent')).not.toBeInTheDocument();
    expect(within(list()).getByText('Save File')).toBeInTheDocument();
  });

  it('lists the symbols of the file in front after an @, and nothing else', async () => {
    documentSymbols.mockResolvedValue([
      {
        name: 'load',
        kind: 12,
        detail: '(path) -> Frame',
        line: 4,
        character: 4,
        endLine: 9,
        children: [],
      },
      { name: 'tidy', kind: 12, detail: '', line: 12, character: 4, endLine: 20, children: [] },
    ]);
    renderOverEditor();

    fireEvent.change(input(), { target: { value: '@lo' } });

    await waitFor(() => expect(within(list()).getByText('load')).toBeInTheDocument());
    expect(within(list()).getByText('(path) -> Frame')).toBeInTheDocument();
    // Filtered in the browser: the server answered with every symbol at once.
    expect(within(list()).queryByText('tidy')).not.toBeInTheDocument();
    // A prefix picks one question: the commands and the files stay out of it.
    expect(within(list()).queryByText('Commands')).not.toBeInTheDocument();
    expect(searchFiles).not.toHaveBeenCalled();
  });

  it('asks every server for a symbol after a #, and opens the file it is in', async () => {
    workspaceSymbols.mockResolvedValue([
      { path: 'batch/run.go', name: 'GreetAll', kind: 12, line: 21, character: 5 },
    ]);
    renderOverEditor();

    fireEvent.change(input(), { target: { value: '#Greet' } });

    await waitFor(() => expect(within(list()).getByText('GreetAll')).toBeInTheDocument());
    expect(workspaceSymbols).toHaveBeenCalledWith('Greet');

    fireEvent.click(within(list()).getByText('GreetAll'));

    expect(screen.getByTestId('tabs')).toHaveTextContent('batch/run.go');
  });
});
