import { IKernel, IKernelspecsState } from '../store/AppState';
import { requestEmpty, requestJson } from './client';

export async function listKernelspecs(): Promise<IKernelspecsState> {
  const res = await requestJson<{ kernelspecs?: IKernelspecsState }>('/api/kernelspecs');
  return res.kernelspecs || {};
}

/**
 * Every kernel this server is running, which is not the same as every kernel this browser tab started
 * one of. A reload loses the second list and not the first.
 *
 * The model also carries `last_activity`, `execution_state` and `connections`. They are left out of
 * `IKernel` on purpose: `KernelManager` declares all three and writes none of them, so the server
 * answers with an empty string, an empty string and a zero — and a field in the type is an invitation
 * to render one of those.
 */
export function listKernels(): Promise<IKernel[]> {
  return requestJson<IKernel[]>('/api/kernels');
}

export function interruptKernel(kernelId: string): Promise<void> {
  return requestEmpty(`/api/kernels/${kernelId}/interrupt`, { method: 'POST' });
}

/** Kills a kernel, and with it any session bound to it. */
export function deleteKernel(kernelId: string): Promise<void> {
  return requestEmpty(`/api/kernels/${kernelId}`, { method: 'DELETE' });
}
