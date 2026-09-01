import { requestJson } from './client';

export interface ILoginResponse {
  token: string;
  redirect_path: string;
}

/** Exchanges a server access token for a JWT. Rejects with an ApiError on 401/403/500. */
export function login(accessToken: string): Promise<ILoginResponse> {
  return requestJson<ILoginResponse>('/auth/login', {
    method: 'POST',
    body: { accessToken },
  });
}
