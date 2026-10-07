import { ApiError } from './client';
import { requestJson } from './client';

/** A folder whose code may run, and since when (RFC 3339). */
export interface TrustedFolder {
  path: string;
  since: string;
}

/** `/api/trust`: whether the project's code may run, and why. See docs/TRUST.md. */
export interface TrustState {
  /** The project, absolute. The one folder the question is about. */
  folder: string;
  trusted: boolean;
  /** How it came to be trusted; '' while it is restricted. */
  by: '' | 'folder' | 'parent' | 'all' | 'flag' | 'env';
  /** The trusted folder that covers the project, for `folder` and `parent`. */
  through?: string;
  trust_all: boolean;
  /** The environment trusts every folder, which config cannot change: the Docker image. */
  env: boolean;
  folders: TrustedFolder[];
  /** The project's own Python while it is restricted: shown as what trusting would start. */
  environment?: string;
}

export function getTrust(): Promise<TrustState> {
  return requestJson<TrustState>('/api/trust');
}

/** Trusts the project or a folder it is in, and answers the state that follows. */
export function trustFolder(path: string): Promise<TrustState> {
  return requestJson<TrustState>('/api/trust', { method: 'POST', body: { path } });
}

export function forgetTrustedFolder(path: string): Promise<TrustState> {
  return requestJson<TrustState>('/api/trust', { method: 'DELETE', body: { path } });
}

export function setTrustAll(trustAll: boolean): Promise<TrustState> {
  return requestJson<TrustState>('/api/trust/all', {
    method: 'PUT',
    body: { trust_all: trustAll },
  });
}

/** Whether the server refused because the project is not trusted, which the UI turns into the question. */
export function isUntrusted(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.body.includes('"untrusted"');
}
