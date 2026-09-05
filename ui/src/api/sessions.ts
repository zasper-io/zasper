import { IKernel } from '../store/AppState';
import { requestEmpty, requestJson } from './client';

export interface ISession {
  id: string;
  path: string;
  name: string;
  type: string;
  kernel: IKernel;
}

/**
 * Every open session, keyed by session id as the server sends it. This is the only thing that knows
 * which file a running kernel belongs to — a kernel on its own is a name and an id.
 */
export function listSessions(): Promise<Record<string, ISession>> {
  return requestJson<Record<string, ISession>>('/api/sessions');
}

/**
 * The session already running `path`, if there is one.
 *
 * Closing a notebook's tab leaves its kernel running, so opening a notebook starts with asking what is
 * already there — Jupyter's own `findByPath`. By path alone: the point is to find the kernel whatever
 * it turns out to be, and matching on a name as well is how a notebook ends up with two.
 */
export async function sessionForPath(path: string): Promise<ISession | undefined> {
  const open = await listSessions();
  return Object.values(open).find((session) => session.path === path);
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
