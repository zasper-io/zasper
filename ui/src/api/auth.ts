import { requestEmpty, requestJson } from './client';

export interface ILoginResponse {
  token: string;
  redirect_path: string;
}

/** Signs this browser's session out on the server, which also drops the cookie. */
export function logout(): Promise<void> {
  return requestEmpty('/auth/logout', { method: 'POST' });
}

/**
 * Exchanges a server access token for a session, which the server sets as a cookie. Rejects with an
 * ApiError on 401, 429 and 500.
 */
export function login(accessToken: string): Promise<ILoginResponse> {
  return requestJson<ILoginResponse>('/auth/login', {
    method: 'POST',
    body: { accessToken },
  });
}
