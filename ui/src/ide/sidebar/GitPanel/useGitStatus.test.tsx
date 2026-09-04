import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGitStatus } from './useGitStatus';
import type { GitStatus } from '@/api';

const getGitStatus = vi.fn();
const toastError = vi.fn();

vi.mock('@/api', async () => ({
  getGitStatus: () => getGitStatus(),
  emptyGitStatus: (await import('@/api/git')).emptyGitStatus,
  apiErrorMessage: (await import('@/api/client')).apiErrorMessage,
}));

vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: (message: string) => toastError(message) },
}));

/** A stand-in for the watch socket, as in useContentWatcher's own test. */
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

const aStatus = (branch: string): GitStatus => ({
  isRepository: true,
  gitAvailable: true,
  branch,
  upstream: '',
  ahead: 0,
  behind: 0,
  hasRemote: false,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  getGitStatus.mockResolvedValue(aStatus('main'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useGitStatus', () => {
  it('re-reads when the project changes on disk', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useGitStatus(false));
      await vi.waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(1));

      // A commit from a terminal, or a branch checked out behind the panel's back: the watcher is the
      // only thing that notices, and a source control panel that does not is worse than none.
      getGitStatus.mockResolvedValue(aStatus('other'));
      act(() => {
        FakeSocket.latest.onmessage?.();
        vi.advanceTimersByTime(500);
      });

      await vi.waitFor(() => expect(result.current.status.branch).toBe('other'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores what the watcher reports while the panel is hidden', async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useGitStatus(true));
      act(() => {
        FakeSocket.latest.onmessage?.();
        vi.advanceTimersByTime(500);
      });

      // Nothing is on screen to be wrong, and `pip install` alone would otherwise be a status read
      // every half second for a panel nobody opened.
      expect(getGitStatus).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed read into the panel rather than as a toast', async () => {
    getGitStatus.mockRejectedValue(new Error('the server is gone'));
    const { result } = renderHook(() => useGitStatus(false));

    await waitFor(() => expect(result.current.error).toBe('the server is gone'));
    // The watcher fires this read on its own, so a server that has gone away would otherwise raise a
    // toast every time it reconnected.
    expect(toastError).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('takes the status a write answers with, and says whether it worked', async () => {
    const { result } = renderHook(() => useGitStatus(false));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let worked: boolean | undefined;
    await act(async () => {
      worked = await result.current.run(async () => aStatus('after'), 'Done.');
    });

    expect(worked).toBe(true);
    // No second request: the endpoint already answered with the state it left the repository in.
    expect(getGitStatus).toHaveBeenCalledTimes(1);
    expect(result.current.status.branch).toBe('after');
  });

  it('toasts what a failed write said, and says it did not work', async () => {
    const { result } = renderHook(() => useGitStatus(false));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let worked: boolean | undefined;
    await act(async () => {
      worked = await result.current.run(async () => {
        throw new Error('Please tell me who you are');
      }, 'Committed.');
    });

    expect(worked).toBe(false);
    // The server's own words. The panel used to say "An error occurred while committing changes."
    expect(toastError).toHaveBeenCalledWith('Please tell me who you are');
    expect(result.current.busy).toBe(false);
  });
});
