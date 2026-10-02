import { useCallback, useEffect, useRef } from 'react';

import { ApiError, getKernel, Session } from '@/api';

const FIRST_RETRY_MS = 1000;
const LONGEST_RETRY_MS = 15000;

/**
 * Reopens a notebook's kernel socket after it drops — a laptop that slept, a network that went away —
 * for as long as the kernel is still running. The server keeps every run's output meanwhile and replays
 * it on the new socket. Answers what to call when the socket closes.
 */
export function useKernelReconnect(
  session: Session | null | undefined,
  reopen: (session: Session) => Promise<void>
): () => void {
  const current = useRef(session);
  current.current = session;
  const timer = useRef<number | undefined>(undefined);
  const delay = useRef(FIRST_RETRY_MS);
  // A failed attempt both rejects and closes its socket; only the rejection schedules the next one.
  const inFlight = useRef(false);
  const attempt = useRef<(target: Session) => void>(() => {});

  const schedule = useCallback((target: Session) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => attempt.current(target), delay.current);
    delay.current = Math.min(delay.current * 2, LONGEST_RETRY_MS);
  }, []);

  attempt.current = (target: Session) => {
    timer.current = undefined;
    // Restarted, switched or closed since: the socket that dropped is not this tab's any more.
    if (current.current?.id !== target.id) {
      return;
    }
    inFlight.current = true;
    getKernel(target.kernel.id)
      .then(() => reopen(target))
      .then(() => {
        delay.current = FIRST_RETRY_MS;
      })
      .catch((error: unknown) => {
        // A stopped kernel is not coming back; anything else is the network, which might.
        if (!(error instanceof ApiError && error.status === 404)) {
          schedule(target);
        }
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  useEffect(() => {
    // Back online, or back from the back/forward cache, is the moment most worth trying.
    const retryNow = () => {
      const target = current.current;
      if (timer.current !== undefined && target) {
        window.clearTimeout(timer.current);
        delay.current = FIRST_RETRY_MS;
        attempt.current(target);
      }
    };
    window.addEventListener('online', retryNow);
    window.addEventListener('pageshow', retryNow);
    return () => {
      window.removeEventListener('online', retryNow);
      window.removeEventListener('pageshow', retryNow);
      window.clearTimeout(timer.current);
    };
  }, []);

  return useCallback(() => {
    const target = current.current;
    if (target && !inFlight.current && timer.current === undefined) {
      schedule(target);
    }
  }, [schedule]);
}
