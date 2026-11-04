import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NotebookCell } from '@/api';
import { useNotebookAnnouncer } from './useNotebookAnnouncer';

function cell(id: string, outputs: NotebookCell['outputs'] = []): NotebookCell {
  return {
    id,
    cell_type: 'code',
    source: '',
    metadata: {},
    execution_count: 1,
    outputs,
    reload: false,
  };
}

function announcer(cells: NotebookCell[], running: Set<string>, status = 'idle') {
  return renderHook(({ cells, running, status }) => useNotebookAnnouncer(cells, running, status), {
    initialProps: { cells, running, status },
  });
}

describe('useNotebookAnnouncer', () => {
  it('says a cell finished when it stops running', () => {
    const cells = [cell('a'), cell('b')];
    const { result, rerender } = announcer(cells, new Set(['b']));
    expect(result.current).toBe('');

    rerender({ cells, running: new Set(), status: 'idle' });
    expect(result.current).toBe('Cell 2 finished');
  });

  it('says what a cell raised', () => {
    const failed = [
      cell('a', [{ output_type: 'error', ename: 'NameError', evalue: 'x', traceback: [] }]),
    ];
    const { result, rerender } = announcer([cell('a')], new Set(['a']));

    rerender({ cells: failed, running: new Set(), status: 'idle' });
    expect(result.current).toBe('Cell 1 raised NameError');
  });

  // The same words twice are no change to a live region, so the second would not be read.
  it('says it again when the same cell finishes again', () => {
    const cells = [cell('a')];
    const { result, rerender } = announcer(cells, new Set(['a']));
    rerender({ cells, running: new Set(), status: 'idle' });
    const first = result.current;
    rerender({ cells, running: new Set(['a']), status: 'busy' });
    rerender({ cells, running: new Set(), status: 'idle' });

    expect(result.current).not.toBe(first);
    expect(result.current.trim()).toBe('Cell 1 finished');
  });

  it('says the kernel restarting and coming back, and not every busy and idle', () => {
    const cells = [cell('a')];
    const { result, rerender } = announcer(cells, new Set());

    rerender({ cells, running: new Set(), status: 'busy' });
    rerender({ cells, running: new Set(), status: 'idle' });
    expect(result.current).toBe('');

    rerender({ cells, running: new Set(), status: 'restarting' });
    expect(result.current).toBe('Kernel restarting');
    rerender({ cells, running: new Set(), status: 'idle' });
    expect(result.current).toBe('Kernel ready');
    rerender({ cells, running: new Set(), status: 'dead' });
    expect(result.current).toBe('Kernel died');
  });

  // Zasper restarts by starting a new session: the socket closes, a new one connects, then idle.
  it('says the kernel is ready again after a restart that is a new session', () => {
    const cells = [cell('a')];
    const { result, rerender } = announcer(cells, new Set());
    rerender({ cells, running: new Set(), status: 'disconnected' });
    rerender({ cells, running: new Set(), status: 'connected' });
    // The kernel answers the new connection's first request before it is idle.
    rerender({ cells, running: new Set(), status: 'busy' });
    expect(result.current).toBe('Kernel disconnected');
    rerender({ cells, running: new Set(), status: 'idle' });
    expect(result.current).toBe('Kernel ready');
  });
});
