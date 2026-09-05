import { IKernel, IKernelspecsState } from '../store/AppState';
import { requestEmpty, requestJson } from './client';

export async function listKernelspecs(): Promise<IKernelspecsState> {
  const res = await requestJson<{ kernelspecs?: IKernelspecsState }>('/api/kernelspecs');
  return res.kernelspecs || {};
}

/**
 * A kernel as `/api/kernels` reports it, in the server's own snake case.
 *
 * `IKernel` is the pair every other endpoint sends — a name and an id — and these three are what the
 * server knows about a kernel that this window may have nothing to do with.
 */
export interface IKernelModel extends IKernel {
  /** RFC 3339, UTC. When the kernel last published anything, or when it started if it never has. */
  last_activity: string;
  /**
   * `starting`, `busy` or `idle` — Jupyter's own names, and the last thing the kernel itself said rather
   * than a guess about what it is doing. `starting` only for the moment between a kernel being launched
   * and its first message; the server listens to every kernel it runs, so this is answered for a kernel
   * no window has ever opened.
   */
  execution_state: string;
  /** Clients this server is forwarding to, which is 0 for a kernel whose notebook has been closed. */
  connections: number;
}

/**
 * Every kernel this server is running, which is not the same as every kernel this browser tab started
 * one of. A reload loses the second list and not the first.
 */
export function listKernels(): Promise<IKernelModel[]> {
  return requestJson<IKernelModel[]>('/api/kernels');
}

export function interruptKernel(kernelId: string): Promise<void> {
  return requestEmpty(`/api/kernels/${kernelId}/interrupt`, { method: 'POST' });
}

/** Kills a kernel, and with it any session bound to it. */
export function deleteKernel(kernelId: string): Promise<void> {
  return requestEmpty(`/api/kernels/${kernelId}`, { method: 'DELETE' });
}
