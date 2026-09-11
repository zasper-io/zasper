import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Login from './Login';
import { ApiError } from '@/api/client';

const login = vi.fn();
const navigate = vi.fn();

vi.mock('@/api', async () => ({
  login: (token: string) => login(token),
  ApiError: (await import('@/api/client')).ApiError,
}));

vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  ToastContainer: () => null,
}));

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}));

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
}

function submit(token: string) {
  fireEvent.change(screen.getByLabelText('Server access token'), {
    target: { value: token },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('Login', () => {
  it('takes a token and goes where the server sends it', async () => {
    login.mockResolvedValue({ token: 'abc123', redirect_path: '/' });
    renderLogin();

    submit('a-server-token');

    await waitFor(() => expect(login).toHaveBeenCalledWith('a-server-token'));
    await waitFor(() => expect(localStorage.getItem('token')).toBe('abc123'));
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('says in the form that the token was rejected, and clears the field', async () => {
    login.mockRejectedValue(new ApiError('POST', '/login', 401, 'unauthorized'));
    renderLogin();
    expect(screen.queryByRole('alert')).toBeNull();

    submit('the-wrong-one');

    expect(await screen.findByRole('alert')).toHaveTextContent('That token was not accepted.');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Server access token')).toHaveValue('');
  });

  it('submits on Enter, as a form', async () => {
    login.mockResolvedValue({ token: 'abc123', redirect_path: '/' });
    renderLogin();

    const field = screen.getByLabelText('Server access token');
    fireEvent.change(field, { target: { value: 'typed' } });
    fireEvent.submit(field.closest('form')!);

    await waitFor(() => expect(login).toHaveBeenCalledWith('typed'));
  });

  it('shows the token on request', () => {
    renderLogin();
    const field = screen.getByLabelText('Server access token');
    const reveal = screen.getByRole('button', { name: 'Show token' });
    expect(field).toHaveAttribute('type', 'password');

    fireEvent.click(reveal);

    expect(field).toHaveAttribute('type', 'text');
    expect(reveal).toHaveAttribute('aria-pressed', 'true');
  });

  // Off the platform check in commands/keys.ts, jsdom is not a Mac, so Mod is Ctrl here.
  it('zooms with Mod +/-/0, as the IDE does, and remembers the level', () => {
    renderLogin();

    fireEvent.keyDown(window, { key: '0', ctrlKey: true });
    fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    expect(localStorage.getItem('zasper.zoom')).toBe('1');

    fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    expect(localStorage.getItem('zasper.zoom')).toBe('-1');
  });

  it('does not ask for a token that is already held', () => {
    localStorage.setItem('token', 'abc123');
    renderLogin();

    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  // Every sentence is in the DOM and in source order; that the animation is CSS is the point.
  it('carries all four sentences, whether or not they are moving', () => {
    renderLogin();

    const slides = screen.getAllByRole('listitem').map((slide) => slide.textContent);
    expect(slides).toEqual([
      'Welcome to Zasper!',
      'Fast, reliable, and secure.',
      'Upto 5X less CPU usage.',
      'Upto 40X less memory usage.',
    ]);
  });

  // Bootstrap's grid and navbar came out with this page, and they were only ever here.
  it('wears none of the Bootstrap grid that came out with it', () => {
    const { container } = renderLogin();

    expect(container.querySelectorAll('.container, .row, .col-12, .navbar, .mx-auto')).toHaveLength(
      0
    );
  });
});
