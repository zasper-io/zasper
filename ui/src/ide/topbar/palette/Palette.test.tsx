import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Palette from './Palette';
import { IContentEntry } from '@/api';
import { ICommand } from '@/commands/types';
import { fileTabsAtom } from '@/store/TabState';
import { Provider, useAtomValue } from 'jotai';

const searchFiles = vi.fn();

// useTabActions reaches for the first two; nothing here makes it kill a kernel, but a name the mock
// does not define is an error the moment anything touches it.
vi.mock('@/api', () => ({
  searchFiles: (query: string) => searchFiles(query),
  deleteKernel: vi.fn(),
  logApiError: () => () => {},
}));

function command(overrides: Partial<ICommand>): ICommand {
  return {
    id: 'test',
    label: 'Test',
    category: 'File',
    scope: 'app',
    execute: vi.fn(),
    ...overrides,
  };
}

function entry(path: string): IContentEntry {
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

/** The field, which is also the widget: everything below is typed into it. */
function input(): HTMLElement {
  return screen.getByPlaceholderText('Search files, or > for commands');
}

let mockCommands: ICommand[];

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

  it('filters commands based on query', () => {
    renderPalette();
    fireEvent.change(input(), { target: { value: 'Open File' } });
    expect(screen.getByText('Open File')).toBeInTheDocument();
    expect(screen.queryByText('Save File')).not.toBeInTheDocument();
    expect(screen.queryByText('Close File')).not.toBeInTheDocument();
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
    expect(screen.getByText('Open File').parentElement).toHaveClass('selected');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getByText('Save File').parentElement).toHaveClass('selected');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getByText('Open File').parentElement).toHaveClass('selected');
  });

  it('executes the selected command on Enter', () => {
    const onClose = vi.fn();
    renderPalette({ initialQuery: '>', onClose });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(mockCommands[0].execute).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
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

  it('executes command on click', () => {
    const onClose = vi.fn();
    renderPalette({ initialQuery: '>', onClose });
    fireEvent.click(screen.getByText('Open File'));
    expect(mockCommands[0].execute).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a disabled command but refuses to run it', () => {
    const onClose = vi.fn();
    const disabled = command({ id: 'nb:restart', label: 'Restart Kernel', isEnabled: () => false });
    renderPalette({ commands: [disabled], initialQuery: '>', onClose });

    expect(screen.getByText('Restart Kernel').parentElement).toHaveClass('disabled');
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
