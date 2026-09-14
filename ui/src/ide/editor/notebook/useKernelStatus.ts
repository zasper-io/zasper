import { useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';

import { kernelStatusAtom } from '@/store/kernels';

/**
 * A kernel's state as this notebook last heard it, published for anything outside the notebook that
 * wants it — the Jupyter info panel, so far. Published from one effect rather than from each place that
 * sets it, and dropped when the notebook lets go of the kernel: a status nobody maintains is worse than
 * none.
 */
export function useKernelStatus(kernelId: string | undefined) {
  const [kernelStatus, setKernelStatus] = useState('idle');
  const setKernelStatuses = useSetAtom(kernelStatusAtom);

  useEffect(() => {
    if (kernelId === undefined) {
      return;
    }
    setKernelStatuses((previous) => ({ ...previous, [kernelId]: kernelStatus }));
  }, [kernelId, kernelStatus, setKernelStatuses]);

  useEffect(() => {
    if (kernelId === undefined) {
      return;
    }
    return () =>
      setKernelStatuses((previous) => {
        const next = { ...previous };
        delete next[kernelId];
        return next;
      });
  }, [kernelId, setKernelStatuses]);

  return [kernelStatus, setKernelStatus] as const;
}
