import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RouteConfig from './routes';

const login = vi.fn();

vi.mock('@/api', () => ({
  login: (token: string) => login(token),
  logApiError: () => () => {},
}));

vi.mock('@/ide/IDE', () => ({ default: () => <p>the IDE</p> }));
vi.mock('@/auth/Login', () => ({ default: () => <p>the login page</p> }));

// Waited for in place rather than found once: the route chunks load lazily, so the page appears a
// render or two after the first.
async function shows(text: string) {
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('RouteConfig', () => {
  it('signs in with the token in the link the server opened, and takes it out of the URL', async () => {
    login.mockResolvedValue({ token: 'a-jwt', redirect_path: '/' });
    window.history.replaceState(null, '', '/?token=the-access-token');

    render(<RouteConfig />);

    await shows('the IDE');
    expect(login).toHaveBeenCalledWith('the-access-token');
    expect(localStorage.getItem('zasper.signedIn')).not.toBeNull();
    expect(window.location.search).toBe('');
  });

  it('falls back to the login page when the token in the link is refused', async () => {
    login.mockRejectedValue(new Error('401'));
    window.history.replaceState(null, '', '/?token=stale');

    render(<RouteConfig />);

    await shows('the login page');
    expect(window.location.search).toBe('');
  });

  it('keeps the session it holds when the token in the link is refused', async () => {
    localStorage.setItem('zasper.signedIn', '1');
    login.mockRejectedValue(new Error('401'));
    window.history.replaceState(null, '', '/?token=stale');

    render(<RouteConfig />);

    await waitFor(() => expect(login).toHaveBeenCalled());
    await shows('the IDE');
    expect(localStorage.getItem('zasper.signedIn')).not.toBeNull();
  });

  // Earlier versions kept the session itself in localStorage, where any script could read it. Such a
  // token is not a session any more, so the browser signs in again.
  it('sends a browser holding only an old token to sign in', async () => {
    localStorage.setItem('token', 'an-old-jwt');

    render(<RouteConfig />);

    await shows('the login page');
  });

  it('does not sign in when the link carries no token', async () => {
    localStorage.setItem('zasper.signedIn', '1');

    render(<RouteConfig />);

    await shows('the IDE');
    expect(login).not.toHaveBeenCalled();
  });
});
