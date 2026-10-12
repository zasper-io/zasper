import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkServer, serverAnswered } from './serverConnection';
import { useContentWatcher, useFileWatcher } from './useContentWatcher';

const serverAnswers = vi.fn();

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  serverAnswers: () => serverAnswers(),
}));

/** A stand-in for the socket the panel opens, so nothing here reaches a real backend. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  send = vi.fn();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  static get latest(): FakeSocket {
    return FakeSocket.instances[FakeSocket.instances.length - 1];
  }
}

describe('useContentWatcher', () => {
  let onChange: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    onChange = vi.fn();
    serverAnswers.mockReset().mockResolvedValue(true);
    serverAnswered();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('listens on the watch endpoint', () => {
    renderHook(() => useContentWatcher(onChange));

    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.latest.url).toContain('/api/contents/watch');
  });

  it('collapses a burst of events into one reload', () => {
    renderHook(() => useContentWatcher(onChange));

    // What installing a package looks like from here: one message per file written.
    act(() => {
      for (let i = 0; i < 500; i++) {
        FakeSocket.latest.onmessage?.({ data: 'reload' });
      }
      vi.advanceTimersByTime(500);
    });

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('reloads again for what happens after that', () => {
    renderHook(() => useContentWatcher(onChange));

    act(() => {
      FakeSocket.latest.onmessage?.({ data: 'reload' });
      vi.advanceTimersByTime(500);
      FakeSocket.latest.onmessage?.({ data: 'reload' });
      vi.advanceTimersByTime(500);
    });

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('reloads with whatever is open at the time, not what was open when it connected', () => {
    const { rerender } = renderHook(({ callback }) => useContentWatcher(callback), {
      initialProps: { callback: onChange },
    });
    const later = vi.fn();

    rerender({ callback: later });
    act(() => {
      FakeSocket.latest.onmessage?.({ data: 'reload' });
      vi.advanceTimersByTime(500);
    });

    expect(later).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(1); // and without reconnecting to get there
  });

  describe('when the connection drops', () => {
    it('reconnects, backing off as it goes', () => {
      renderHook(() => useContentWatcher(onChange));

      act(() => FakeSocket.latest.onclose?.());
      expect(FakeSocket.instances).toHaveLength(1);
      act(() => vi.advanceTimersByTime(1000));
      expect(FakeSocket.instances).toHaveLength(2);

      act(() => FakeSocket.latest.onclose?.());
      act(() => vi.advanceTimersByTime(1000));
      expect(FakeSocket.instances).toHaveLength(2); // the second wait is longer
      act(() => vi.advanceTimersByTime(1000));
      expect(FakeSocket.instances).toHaveLength(3);
    });

    it('asks whether the server is still there', () => {
      renderHook(() => useContentWatcher(onChange));

      act(() => FakeSocket.latest.onclose?.());

      expect(serverAnswers).toHaveBeenCalledOnce();
    });

    it('reconnects as soon as the server answers again, without waiting out the backoff', async () => {
      serverAnswers.mockResolvedValue(false);
      renderHook(() => useContentWatcher(onChange));
      await act(async () => FakeSocket.latest.onclose?.());
      expect(FakeSocket.instances).toHaveLength(1);

      serverAnswers.mockResolvedValue(true);
      await act(async () => {
        await checkServer();
      });

      expect(FakeSocket.instances).toHaveLength(2);
    });

    it('reloads once it is back, since nothing was reported while it was down', () => {
      renderHook(() => useContentWatcher(onChange));

      act(() => FakeSocket.latest.onopen?.());
      expect(onChange).not.toHaveBeenCalled(); // the panel has just read the tree itself

      act(() => FakeSocket.latest.onclose?.());
      act(() => vi.advanceTimersByTime(1000));
      act(() => FakeSocket.latest.onopen?.());

      expect(onChange).toHaveBeenCalledOnce();
    });
  });

  it('shares one socket between everyone listening, and keeps it until the last one goes', () => {
    const first = renderHook(() => useContentWatcher(onChange));
    const other = vi.fn();
    const second = renderHook(() => useContentWatcher(other));

    expect(FakeSocket.instances).toHaveLength(1);
    act(() => {
      FakeSocket.latest.onmessage?.({ data: 'reload' });
      vi.advanceTimersByTime(500);
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce();

    first.unmount();
    expect(FakeSocket.latest.close).not.toHaveBeenCalled();

    second.unmount();
    expect(FakeSocket.latest.close).toHaveBeenCalled();
  });

  it('stops when the panel goes', () => {
    const { unmount } = renderHook(() => useContentWatcher(onChange));
    const socket = FakeSocket.latest;

    unmount();
    act(() => socket.onclose?.());
    act(() => vi.advanceTimersByTime(60000));

    expect(socket.close).toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  describe('a file an editor has open', () => {
    function open(socket: FakeSocket) {
      act(() => {
        socket.readyState = FakeSocket.OPEN;
        socket.onopen?.();
      });
    }

    function changed(changes: { path: string; hash?: string }[]) {
      act(() => {
        FakeSocket.latest.onmessage?.({ data: JSON.stringify({ changed: changes }) });
        vi.advanceTimersByTime(500);
      });
    }

    it('tells the server which files are open, and again when that changes', () => {
      renderHook(() => useContentWatcher(onChange));
      open(FakeSocket.latest);
      const notes = renderHook(() => useFileWatcher('notes.txt', vi.fn()));
      expect(FakeSocket.latest.send).toHaveBeenLastCalledWith(
        JSON.stringify({ watch: ['notes.txt'] })
      );

      notes.unmount();

      expect(FakeSocket.latest.send).toHaveBeenLastCalledWith(JSON.stringify({ watch: [] }));
    });

    it('sends the files open when it connects', () => {
      renderHook(() => useFileWatcher('./data/run.py', vi.fn()));

      open(FakeSocket.latest);

      expect(FakeSocket.latest.send).toHaveBeenCalledWith(
        JSON.stringify({ watch: ['data/run.py'] })
      );
    });

    it('is told of a change to its own file, with the hash the file now holds', () => {
      const notes = vi.fn();
      const other = vi.fn();
      renderHook(() => useFileWatcher('notes.txt', notes));
      renderHook(() => useFileWatcher('other.txt', other));

      changed([{ path: 'notes.txt', hash: 'abc' }]);

      expect(notes).toHaveBeenCalledExactlyOnceWith('abc');
      expect(other).not.toHaveBeenCalled();
    });

    it('is told of the latest version when its file changes several times', () => {
      const notes = vi.fn();
      renderHook(() => useFileWatcher('notes.txt', notes));

      act(() => {
        FakeSocket.latest.onmessage?.({
          data: JSON.stringify({ changed: [{ path: 'notes.txt', hash: 'first' }] }),
        });
        FakeSocket.latest.onmessage?.({
          data: JSON.stringify({ changed: [{ path: 'notes.txt', hash: 'second' }] }),
        });
        vi.advanceTimersByTime(500);
      });

      expect(notes).toHaveBeenCalledExactlyOnceWith('second');
    });

    it('is told without a hash when the server says to read everything again', () => {
      const notes = vi.fn();
      renderHook(() => useFileWatcher('notes.txt', notes));

      act(() => {
        FakeSocket.latest.onmessage?.({ data: 'reload' });
        vi.advanceTimersByTime(500);
      });

      expect(notes).toHaveBeenCalledExactlyOnceWith(undefined);
    });

    it('leaves listeners for the whole project told of every change', () => {
      renderHook(() => useContentWatcher(onChange));

      changed([{ path: 'anything.txt' }]);

      expect(onChange).toHaveBeenCalledOnce();
    });
  });
});
