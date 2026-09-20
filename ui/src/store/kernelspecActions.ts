import { useCallback } from 'react';
import { useSetAtom } from 'jotai';

import { listKernelspecs, logApiError } from '@/api';
import { kernelspecsAtom, kernelspecsStatusAtom } from '@/store/kernels';

export interface KernelspecActions {
  /** Reads the installed kernels into `kernelspecsAtom` and reports how it went. */
  loadKernelspecs: () => Promise<void>;
}

/**
 * The one writer of `kernelspecsAtom`, with two callers: IDE.tsx at boot, and the launcher's
 * "Check again". A tab owning the fetch would leave the list missing whenever that tab is closed.
 */
export function useKernelspecActions(): KernelspecActions {
  const setKernelspecs = useSetAtom(kernelspecsAtom);
  const setStatus = useSetAtom(kernelspecsStatusAtom);

  const loadKernelspecs = useCallback(async () => {
    setStatus('loading');
    try {
      setKernelspecs(await listKernelspecs());
      setStatus('ready');
    } catch (error) {
      logApiError('Failed to read the installed kernels:')(error);
      setStatus('failed');
    }
  }, [setKernelspecs, setStatus]);

  return { loadKernelspecs };
}
