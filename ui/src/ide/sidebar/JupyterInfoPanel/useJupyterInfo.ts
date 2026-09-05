import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';

import { apiErrorMessage, ISession, listKernels, listSessions } from '@/api';
import { IKernel } from '@/store/AppState';

/** A kernel the server is running, and the session that says what it is running for. */
export interface IRunningKernel extends IKernel {
  /** Absent for a kernel with nothing attached to it, which is a kernel nobody can reach. */
  session?: ISession;
}

export interface IJupyterInfo {
  kernels: IRunningKernel[];
  /** True until the first read has come back, so the panel can say nothing rather than "none". */
  loading: boolean;
  /** True while an action is in flight; every button is disabled meanwhile. */
  busy: boolean;
  /** Why the last read failed, empty when it did not. Shown in the panel rather than toasted. */
  error: string;
  refresh: () => void;
  /** Runs one action, reports it, and reads the list again. Answers whether it worked. */
  run: (action: () => Promise<void>, success?: string) => Promise<boolean>;
}

/**
 * How often the list is read while the panel is on screen.
 *
 * Files have a watcher; kernels have nothing. A kernel that dies of its own accord — a segfault, a
 * `kill` in a terminal, the machine running out of memory — is the state this panel most needs to be
 * right about, and polling is the only way it hears. Two local requests every few seconds, and only
 * while somebody is looking.
 */
const POLL_MS = 5000;

/**
 * What is running on the server: the kernels, and which file each one belongs to.
 *
 * The panel used to read jotai atoms that only this browser tab writes, so a reload emptied it while
 * the kernels went on running. Everything here comes from the server instead.
 *
 * Reads report their failure into the panel and writes report theirs as a toast, as in useGitStatus:
 * a read happens on a timer, and a server that has gone away would otherwise raise a toast every five
 * seconds.
 */
export function useJupyterInfo(hidden: boolean): IJupyterInfo {
  const [kernels, setKernels] = useState<IRunningKernel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      // Together, because a kernel listed without its session is a row that cannot name what it runs.
      const [running, sessions] = await Promise.all([listKernels(), listSessions()]);
      const byKernel = new Map<string, ISession>();
      Object.values(sessions).forEach((session) => byKernel.set(session.kernel.id, session));

      setKernels(
        running
          .map((kernel) => ({ ...kernel, session: byKernel.get(kernel.id) }))
          // The server answers from a map, so without this the rows change places on every read.
          .sort(
            (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
          )
      );
      setError('');
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  // Stable, so a caller can depend on it without asking again on every render.
  const refreshOnce = useCallback(() => void refresh(), [refresh]);

  useEffect(() => {
    // Every sidebar panel stays mounted, so without the guard a panel nobody has opened polls a server
    // nobody is asking. Opening it reads at once, since what is on screen is from last time.
    if (hidden) {
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [hidden, refresh]);

  const run = useCallback(
    async (action: () => Promise<void>, success?: string) => {
      setBusy(true);
      let worked = false;
      try {
        await action();
        worked = true;
        if (success !== undefined) {
          toast.success(success);
        }
      } catch (failure) {
        toast.error(apiErrorMessage(failure));
      }
      setBusy(false);
      // Read again either way. These endpoints answer with a message rather than the new state, and a
      // failure is often a kernel that has already gone — which is exactly a change worth showing.
      await refresh();
      return worked;
    },
    [refresh]
  );

  return { kernels, loading, busy, error, refresh: refreshOnce, run };
}
