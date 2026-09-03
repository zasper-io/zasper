import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPalette from './CommandPalette';
import { ICommand } from '@/commands/types';

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

let mockCommands: ICommand[];

beforeEach(() => {
  mockCommands = [
    command({ id: 'file:open', label: 'Open File', description: 'Open a file in the editor' }),
    command({ id: 'file:save', label: 'Save File', description: 'Save the current file' }),
    command({ id: 'file:close', label: 'Close File', description: 'Close the current file' }),
  ];
});

describe('CommandPalette', () => {
  it('renders CommandPalette component', () => {
    render(<CommandPalette commands={mockCommands} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument();
  });

  it('filters commands based on query', () => {
    render(<CommandPalette commands={mockCommands} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Type a command...'), {
      target: { value: 'Open File' },
    });
    expect(screen.getByText('Open File')).toBeInTheDocument();
    expect(screen.queryByText('Save File')).not.toBeInTheDocument();
    expect(screen.queryByText('Close File')).not.toBeInTheDocument();
  });

  // So that "notebook" finds the notebook's commands without knowing what any of them is called.
  it('filters on the category too', () => {
    render(
      <CommandPalette
        commands={[...mockCommands, command({ id: 'nb:run', label: 'Run', category: 'Notebook' })]}
        onClose={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Type a command...'), {
      target: { value: 'notebook' },
    });
    expect(screen.getByText('Run')).toBeInTheDocument();
    expect(screen.queryByText('Open File')).not.toBeInTheDocument();
  });

  it('handles keyboard navigation', () => {
    render(<CommandPalette commands={mockCommands} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Type a command...');
    // The first match is selected on open, so Enter alone runs it.
    expect(screen.getByText('Open File').parentElement).toHaveClass('selected');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByText('Save File').parentElement).toHaveClass('selected');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByText('Open File').parentElement).toHaveClass('selected');
  });

  it('executes the selected command on Enter', () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={mockCommands} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type a command...');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockCommands[0].execute).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('runs nothing on Enter when the query matches nothing', () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={mockCommands} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type a command...');
    fireEvent.change(input, { target: { value: 'no such command' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    for (const command of mockCommands) {
      expect(command.execute).not.toHaveBeenCalled();
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it('executes command on click', () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={mockCommands} onClose={onClose} />);
    fireEvent.click(screen.getByText('Open File'));
    expect(mockCommands[0].execute).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a disabled command but refuses to run it', () => {
    const onClose = vi.fn();
    const disabled = command({ id: 'nb:restart', label: 'Restart Kernel', isEnabled: () => false });
    render(<CommandPalette commands={[disabled]} onClose={onClose} />);

    expect(screen.getByText('Restart Kernel').parentElement).toHaveClass('disabled');
    fireEvent.click(screen.getByText('Restart Kernel'));

    expect(disabled.execute).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the keybinding, and only shows one when the spellings collapse', () => {
    render(
      <CommandPalette
        commands={[command({ keys: ['Mod-Shift-p', 'Ctrl-Shift-p'] })]}
        onClose={vi.fn()}
      />
    );

    // ⌘⇧P plus ⌃⇧P on mac; the two are one chord elsewhere.
    const shown = screen.getByText(/⇧P|Shift\+P/);
    expect(shown.textContent?.match(/P/g)).toHaveLength(navigator.platform.includes('Mac') ? 2 : 1);
  });

  // A query typed after arrowing down can leave the selection past the end of the shorter list.
  it('does not keep a selection the filtered list no longer has', () => {
    render(<CommandPalette commands={mockCommands} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Type a command...');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    fireEvent.change(input, { target: { value: 'Open' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockCommands[0].execute).toHaveBeenCalled();
    expect(mockCommands[2].execute).not.toHaveBeenCalled();
  });
});
