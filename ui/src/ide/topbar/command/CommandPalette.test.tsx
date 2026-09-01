import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CommandPalette from './CommandPalette';

const mockCommands = [
  { name: 'Open File', description: 'Open a file in the editor', action: vi.fn() },
  { name: 'Save File', description: 'Save the current file', action: vi.fn() },
  { name: 'Close File', description: 'Close the current file', action: vi.fn() },
];
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

  it('handles keyboard navigation', () => {
    render(<CommandPalette commands={mockCommands} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Type a command...');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByText('Open File').parentElement).toHaveClass('selected');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByText('Save File').parentElement).toHaveClass('selected');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByText('Open File').parentElement).toHaveClass('selected');
  });

  it('executes command on Enter key press', () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={mockCommands} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type a command...');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockCommands[0].action).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('executes command on click', () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={mockCommands} onClose={onClose} />);
    fireEvent.click(screen.getByText('Open File'));
    expect(mockCommands[0].action).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
