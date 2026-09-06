import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Login from './Login';
import { ApiError } from '@/api/client';

const login = vi.fn();
const navigate = vi.fn();
const toastError = vi.fn();

vi.mock('@/api', async () => ({
  login: (token: string) => login(token),
  ApiError: (await import('@/api/client')).ApiError,
}));

vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: (message: string) => toastError(message) },
  ToastContainer: () => null,
}));

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}));

function renderLogin() {
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
}

function submit(token: string) {
  fireEvent.change(screen.getByLabelText('Enter Server access token'), {
    target: { value: token },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
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

  it('says which failure it was, and clears the field', async () => {
    login.mockRejectedValue(new ApiError('POST', '/login', 401, 'unauthorized'));
    renderLogin();

    submit('the-wrong-one');

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Invalid username or password'));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Enter Server access token')).toHaveValue('');
  });

  it('does not ask for a token that is already held', () => {
    localStorage.setItem('token', 'abc123');
    renderLogin();

    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  // The carousel, which is four <li>s and a keyframe now that swiper is gone: every sentence is in
  // the DOM and in source order, which is what anything reading the page gets. What the animation
  // does is not this test's business — that it is CSS is the point.
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
    const { container } = render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    expect(container.querySelectorAll('.container, .row, .col-12, .navbar, .mx-auto')).toHaveLength(
      0
    );
  });
});
