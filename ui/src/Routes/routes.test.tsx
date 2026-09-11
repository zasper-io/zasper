import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RouteConfig from './routes';

const login = vi.fn();

vi.mock('@/api', () => ({
  login: (token: string) => login(token),
  getConfig: () => Promise.resolve({ version: 'test', protected: true }),
  logApiError: () => () => {},
}));

vi.mock('@/ide/IDE', () => ({ default: () => <p>the IDE</p> }));
vi.mock('@/auth/Login', () => ({ default: () => <p>the login page</p> }));

// Waited for in place rather than found once: /api/config answering re-renders the route gated, which
// remounts the IDE and detaches the node a findBy would have handed back.
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
    expect(localStorage.getItem('token')).toBe('a-jwt');
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
    localStorage.setItem('token', 'held');
    login.mockRejectedValue(new Error('401'));
    window.history.replaceState(null, '', '/?token=stale');

    render(<RouteConfig />);

    await waitFor(() => expect(login).toHaveBeenCalled());
    await shows('the IDE');
    expect(localStorage.getItem('token')).toBe('held');
  });

  it('does not sign in when the link carries no token', async () => {
    localStorage.setItem('token', 'held');

    render(<RouteConfig />);

    await shows('the IDE');
    expect(login).not.toHaveBeenCalled();
  });
});
