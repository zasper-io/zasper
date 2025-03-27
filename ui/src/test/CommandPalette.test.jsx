import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandPalette from '../ide/topbar/command/CommandPalette';

const mockCommands = [
  { name: 'Open File', description: 'Open a file in the editor', action: jest.fn() },
  { name: 'Save File', description: 'Save the current file', action: jest.fn() },
  { name: 'Close File', description: 'Close the current file', action: jest.fn() },
];
describe('CommandPalette', () => {
  test('renders CommandPalette component', () => {
    render(<CommandPalette commands={mockCommands} onClose={jest.fn()} />);
    expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument();
  });

  test('filters commands based on query', () => {
    render(<CommandPalette commands={mockCommands} onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Type a command...'), {
      target: { value: 'Open File' },
    });
    expect(screen.getByText('Open File')).toBeInTheDocument();
    expect(screen.queryByText('Save File')).not.toBeInTheDocument();
    expect(screen.queryByText('Close File')).not.toBeInTheDocument();
  });

  test('handles keyboard navigation', () => {
    render(<CommandPalette commands={mockCommands} onClose={jest.fn()} />);
    const input = screen.getByPlaceholderText('Type a command...');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByText('Open File').parentElement).toHaveClass('selected');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByText('Save File').parentElement).toHaveClass('selected');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByText('Open File').parentElement).toHaveClass('selected');
  });

  test('executes command on Enter key press', () => {
    const onClose = jest.fn();
    render(<CommandPalette commands={mockCommands} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type a command...');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockCommands[0].action).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('executes command on click', () => {
    const onClose = jest.fn();
    render(<CommandPalette commands={mockCommands} onClose={onClose} />);
    fireEvent.click(screen.getByText('Open File'));
    expect(mockCommands[0].action).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
