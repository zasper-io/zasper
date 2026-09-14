import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useContentWatcher } from './useContentWatcher';

/** A stand-in for the socket the panel opens, so nothing here reaches a real backend. */
class FakeSocket {
  static instances: FakeSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();

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
        FakeSocket.latest.onmessage?.();
      }
      vi.advanceTimersByTime(500);
    });

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('reloads again for what happens after that', () => {
    renderHook(() => useContentWatcher(onChange));

    act(() => {
      FakeSocket.latest.onmessage?.();
      vi.advanceTimersByTime(500);
      FakeSocket.latest.onmessage?.();
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
      FakeSocket.latest.onmessage?.();
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

  it('stops when the panel goes', () => {
    const { unmount } = renderHook(() => useContentWatcher(onChange));
    const socket = FakeSocket.latest;

    unmount();
    act(() => socket.onclose?.());
    act(() => vi.advanceTimersByTime(60000));

    expect(socket.close).toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
