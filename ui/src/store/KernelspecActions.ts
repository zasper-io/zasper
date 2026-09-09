import { useCallback } from 'react';
import { useSetAtom } from 'jotai';

import { listKernelspecs, logApiError } from '@/api';
import { kernelspecsAtom, kernelspecsStatusAtom } from './AppState';

export interface IKernelspecActions {
  /** Reads the installed kernels into `kernelspecsAtom` and reports how it went. */
  loadKernelspecs: () => Promise<void>;
}

/**
 * The one writer of `kernelspecsAtom`, with two callers: IDE.tsx at boot, and the launcher's
 * "Check again". A tab that owns the fetch is a list that is missing whenever that tab is not open,
 * which is what the Jupyter info panel used to see.
 */
export function useKernelspecActions(): IKernelspecActions {
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
