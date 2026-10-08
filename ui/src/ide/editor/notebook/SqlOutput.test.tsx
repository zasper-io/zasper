import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SqlProvenance, SqlRunInfo } from './SqlOutput';

const partial: SqlRunInfo = {
  connection: 'taxi',
  out: 'df_trips',
  rows: 1000,
  more: true,
  limit: 1000,
  seconds: 0.2,
  cached: false,
  ran_at: 1_790_000_000,
  row_bytes: 400,
};

describe('Load all', () => {
  it('counts first and says what reading everything would take, then reads it', async () => {
    const run = vi.fn();
    const count = vi.fn().mockResolvedValue({ rows: 2_964_606 });
    render(<SqlProvenance info={partial} actions={{ run, count }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Load all' }));
    expect(run).not.toHaveBeenCalled();

    const load = await screen.findByRole('button', { name: 'Load all · about 1.1 GB' });
    // In the reader's own grouping, as every count on the page is.
    const total = (2_964_606).toLocaleString();
    expect(screen.getByText(new RegExp(`first 1,000 of ${total} rows`))).toBeInTheDocument();
    fireEvent.click(load);
    expect(run).toHaveBeenCalledWith({ all: true });
  });

  it('says why a count failed, and still loads when asked again', async () => {
    const run = vi.fn();
    const count = vi
      .fn()
      .mockResolvedValue({ rows: null, error: 'Counting took longer than 10 seconds.' });
    render(<SqlProvenance info={partial} actions={{ run, count }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Load all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load all anyway' }));
    expect(screen.getByText(/Not counted: Counting took longer/)).toBeInTheDocument();
    expect(run).toHaveBeenCalledWith({ all: true });
  });
});
