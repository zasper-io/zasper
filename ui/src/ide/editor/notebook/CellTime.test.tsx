import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CellTime, { formatDuration } from './CellTime';

describe('formatDuration', () => {
  it('says a duration the way the border does', () => {
    expect(formatDuration(40)).toBe('<0.1 s');
    expect(formatDuration(412)).toBe('0.4 s');
    expect(formatDuration(12_340)).toBe('12.3 s');
    expect(formatDuration(134_300)).toBe('2 min 14 s');
    expect(formatDuration(3_780_000)).toBe('1 h 3 min');
  });
});

describe('CellTime', () => {
  afterEach(() => vi.useRealTimers());

  it('says how long a finished run took', () => {
    render(
      <CellTime
        isRunning={false}
        timing={{
          'iopub.execute_input': new Date(Date.now() - 140_000).toISOString(),
          'shell.execute_reply': new Date(Date.now() - 5_700).toISOString(),
        }}
      />
    );
    expect(screen.getByText('2 min 14 s')).toBeInTheDocument();
  });

  it('counts up while the kernel is on the cell, and says queued while it waits', () => {
    vi.useFakeTimers();
    const started = new Date(Date.now() - 11_500).toISOString();
    const { rerender } = render(<CellTime isRunning timing={{ sent: new Date().toISOString() }} />);
    expect(screen.getByText('queued')).toBeInTheDocument();

    rerender(<CellTime isRunning timing={{ 'iopub.execute_input': started }} />);
    expect(screen.getByRole('timer')).toHaveTextContent('running · 11 s');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('running · 12 s');
  });

  it('says nothing for a cell that has never run', () => {
    const { container } = render(<CellTime isRunning={false} timing={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
