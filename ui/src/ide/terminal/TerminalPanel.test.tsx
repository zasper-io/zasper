import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Provider } from '@/testing/Provider';
import { currentTerminalAtom, terminalsAtom } from '@/store/terminals';
import TerminalPanel from './TerminalPanel';

// xterm opens a real canvas and measures a character; the panel's own job is which pane is shown.
vi.mock('./Terminal', () => ({
  default: ({ id }: { id: string }) => <div data-testid={`pane-${id}`} />,
}));

const three = {
  'Terminal 1': { id: 'Terminal 1', name: 'Terminal 1' },
  'Terminal 2': { id: 'Terminal 2', name: 'Terminal 2' },
  'Terminal 3': { id: 'Terminal 3', name: 'Terminal 3' },
};

function renderPanel(
  current = 'Terminal 1',
  terminals: typeof three | Record<string, unknown> = three
) {
  render(
    <Provider
      initialValues={[
        [terminalsAtom, terminals],
        [currentTerminalAtom, current],
      ]}
    >
      <TerminalPanel />
    </Provider>
  );
}

/** The row for a shell, which is the `<li>` the button sits in. */
function row(name: string): HTMLElement {
  return screen.getByRole('button', { name }).closest('li')!;
}

describe('TerminalPanel', () => {
  // Every shell stays mounted: a socket torn down and remade is a new shell wearing an old name.
  it('mounts every shell and shows one', () => {
    renderPanel('Terminal 2');

    expect(screen.getByTestId('pane-Terminal 1')).toBeInTheDocument();
    expect(screen.getByTestId('pane-Terminal 3')).toBeInTheDocument();
    const shown = [...document.querySelectorAll<HTMLElement>('.terminalPanel-pane')].filter(
      (pane) => !pane.hidden
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContainElement(screen.getByTestId('pane-Terminal 2'));
  });

  // The list said which one was in the pane in ink weight alone, which is to say it did not say it.
  it('marks the shell in the pane, and moves the mark when another is chosen', () => {
    renderPanel('Terminal 1');

    expect(row('Terminal 1').className).toContain('is-selected');
    expect(row('Terminal 3').className).not.toContain('is-selected');

    fireEvent.click(screen.getByRole('button', { name: 'Terminal 3' }));

    expect(row('Terminal 3').className).toContain('is-selected');
    expect(row('Terminal 1').className).not.toContain('is-selected');
    expect(screen.getByRole('button', { name: 'Terminal 3' })).toHaveAttribute(
      'aria-current',
      'true'
    );
  });

  // A name that is no longer running — a shell shut down from the Jupyter panel — falls back rather
  // than leaving the panel with no pane in it.
  it('falls back to the first shell when the chosen one is gone', () => {
    renderPanel('Terminal 9');

    expect(row('Terminal 1').className).toContain('is-selected');
  });

  // The row is where a shell is closed, and closing it unmounts the pane — which is what ends the
  // shell, since a terminal's life here is its socket.
  it('closes a shell from its row, and takes its pane with it', () => {
    renderPanel('Terminal 1');

    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 2' }));

    expect(screen.queryByRole('button', { name: 'Terminal 2' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('pane-Terminal 2')).not.toBeInTheDocument();
    // The others are untouched, and the shell in the pane is still the shell in the pane.
    expect(screen.getByTestId('pane-Terminal 1')).toBeInTheDocument();
    expect(row('Terminal 1').className).toContain('is-selected');
  });

  // Closing the one on screen has to leave something on screen.
  it('brings the shell before it forward when the one in the pane is closed', () => {
    renderPanel('Terminal 2');

    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 2' }));

    expect(row('Terminal 1').className).toContain('is-selected');
    expect(screen.getByRole('button', { name: 'Terminal 1' })).toHaveAttribute(
      'aria-current',
      'true'
    );
  });

  // The case the list was not drawn for at all: one shell, and nothing in this window could close it.
  it('draws the list for a single shell, with its close', () => {
    renderPanel('Terminal 1', { 'Terminal 1': { id: 'Terminal 1', name: 'Terminal 1' } });

    expect(screen.getByRole('button', { name: 'Close Terminal 1' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 1' }));

    expect(
      screen.getByText('No terminal is running. The status bar starts one.')
    ).toBeInTheDocument();
  });
});
