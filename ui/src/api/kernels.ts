import { IKernelspecsState } from '../store/AppState';
import { requestEmpty, requestJson } from './client';

export async function listKernelspecs(): Promise<IKernelspecsState> {
  const res = await requestJson<{ kernelspecs?: IKernelspecsState }>('/api/kernelspecs');
  return res.kernelspecs || {};
}

export function interruptKernel(kernelId: string): Promise<void> {
  return requestEmpty(`/api/kernels/${kernelId}/interrupt`, { method: 'POST' });
}

/** Kills a kernel, and with it any session bound to it. */
export function deleteKernel(kernelId: string): Promise<void> {
  return requestEmpty(`/api/kernels/${kernelId}`, { method: 'DELETE' });
}
