import { IKernel } from '../store/AppState';
import { requestEmpty, requestJson } from './client';

export interface ISession {
  id: string;
  path: string;
  name: string;
  type: string;
  kernel: IKernel;
}

/** Starts a session, which in turn starts the kernel the notebook runs on. */
export function createSession(
  path: string,
  name: string,
  type: string,
  kernelspec: string
): Promise<ISession> {
  return requestJson<ISession>('/api/sessions', {
    method: 'POST',
    body: { path, name, type, kernel: { name: kernelspec } },
  });
}

/** Shuts a session down, stopping its kernel. */
export function deleteSession(sessionId: string): Promise<void> {
  return requestEmpty(`/api/sessions/${sessionId}`, { method: 'DELETE' });
}
