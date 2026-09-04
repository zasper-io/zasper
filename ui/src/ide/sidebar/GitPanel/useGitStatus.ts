import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

import { apiErrorMessage, emptyGitStatus, getGitStatus, GitStatus } from '@/api';
import { useContentWatcher } from '../FileBrowser/useContentWatcher';

export interface IGitStatus {
  status: GitStatus;
  /** True until the first read has come back, so the panel can say nothing rather than "no changes". */
  loading: boolean;
  /** True while an action is in flight; every button is disabled meanwhile. */
  busy: boolean;
  /** Why the last read failed, empty when it did not. Shown in the panel rather than toasted. */
  error: string;
  refresh: () => void;
  /**
   * Runs one action and takes the status it answers with, reporting whether it worked. Every write
   * endpoint returns the state the repository is now in, so there is no second request to race against
   * — and no window in which the panel shows what was true before the click. The answer matters
   * because a commit whose message must not be cleared is a failed one.
   */
  run: (action: () => Promise<GitStatus>, success?: string) => Promise<boolean>;
}

/**
 * The source control panel's state: what has changed, and one way to change it.
 *
 * Reads report their failure into the panel and writes report theirs as a toast. The asymmetry is
 * deliberate: a read happens on its own, whenever the project changes, and a server that has gone away
 * would otherwise raise a toast every time the watcher fired. A write only ever happens because someone
 * pressed something, and its failure is the answer to that press.
 */
export function useGitStatus(hidden: boolean): IGitStatus {
  const [status, setStatus] = useState<GitStatus>(emptyGitStatus);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // The watcher callback outlives the renders it was made in, so what it needs to know about the
  // current one it reads through a ref.
  const isHidden = useRef<boolean>(hidden);
  isHidden.current = hidden;

  const refresh = useCallback(async () => {
    try {
      setStatus(await getGitStatus());
      setError('');
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Every sidebar panel stays mounted, so the guard is what keeps a panel nobody has opened from
    // asking; opening it reads again, since what is on screen is from last time.
    if (!hidden) {
      void refresh();
    }
  }, [hidden, refresh]);

  // A commit from a terminal, a branch checked out behind the panel's back, a notebook saved: the
  // watcher already reports all of it, and a source control panel that does not notice is worse than
  // none. Nothing is read while the panel is hidden — opening it does that.
  useContentWatcher(() => {
    if (!isHidden.current) {
      void refresh();
    }
  });

  const run = useCallback(async (action: () => Promise<GitStatus>, success?: string) => {
    setBusy(true);
    try {
      setStatus(await action());
      setError('');
      if (success !== undefined) {
        toast.success(success);
      }
      return true;
    } catch (failure) {
      // The server's own words: "Please tell me who you are", or which file is in the way. The panel
      // used to say "An error occurred while committing changes." and throw the rest away.
      toast.error(apiErrorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, loading, busy, error, refresh, run };
}
