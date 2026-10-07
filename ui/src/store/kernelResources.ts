import { useEffect } from 'react';
import { atom, useSetAtom } from 'jotai';

import { getKernelResources, KernelResources } from '@/api';

/** The last answer from `/api/kernels/resources`, shared by the status bar and the Jupyter panel. */
export const kernelResourcesAtom = atom<KernelResources | null>(null);

/**
 * Reads what every kernel holds into kernelResourcesAtom, every `intervalMs` while `enabled` and the page
 * is visible. The status bar and the Jupyter panel each call it on their own timer; the server answers
 * both from one reading a second, so two pollers cost no more than one.
 *
 * A failed read empties the atom rather than leaving the last figures up: a server that has gone away is
 * not still holding 5 GB.
 */
export function usePollKernelResources(enabled: boolean, intervalMs: number): void {
  const setResources = useSetAtom(kernelResourcesAtom);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const read = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      getKernelResources()
        .then((answer) => !cancelled && setResources(answer))
        .catch(() => !cancelled && setResources(null));
    };
    // A tab brought back reads at once rather than showing what it held when it was hidden.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        read();
      }
    };

    read();
    const timer = window.setInterval(read, intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs, setResources]);
}
