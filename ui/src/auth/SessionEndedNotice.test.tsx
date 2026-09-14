import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SessionEndedNotice from './SessionEndedNotice';
import { login } from '@/api';
import { requestEmpty } from '@/api/client';

const fetchMock = vi.fn();

/** What fetch resolves with, reduced to what the API client reads. */
function answer(status: number, body = '{}') {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  });
}

async function saveAnswering(status: number) {
  fetchMock.mockReturnValueOnce(answer(status));
  await act(() => requestEmpty('/api/contents', { method: 'PUT', body: {} }).catch(() => {}));
}

describe('SessionEndedNotice', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    localStorage.clear();
  });

  afterEach(async () => {
    // The client remembers the session across tests, so each one leaves it working.
    await saveAnswering(204);
    vi.unstubAllGlobals();
  });

  it('says so when a request finds the session ended, and keeps the page', async () => {
    localStorage.setItem('zasper.signedIn', '1');
    render(<SessionEndedNotice />);
    expect(screen.queryByRole('alert')).toBeNull();

    await saveAnswering(401);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your session has ended.');
    // So that the sign-in tab shows its form rather than bouncing back to the IDE.
    expect(localStorage.getItem('zasper.signedIn')).toBeNull();
  });

  it('opens sign-in in a new tab', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    render(<SessionEndedNotice />);
    await saveAnswering(401);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(open).toHaveBeenCalledWith('/login', '_blank', 'noopener');
  });

  it('asks again when the tab comes back, and clears once a request works', async () => {
    render(<SessionEndedNotice />);
    await saveAnswering(401);
    await screen.findByRole('alert');

    fetchMock.mockReturnValue(answer(200));
    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/info'), expect.anything());
  });

  it('shows a session that ended before it was on screen', async () => {
    await saveAnswering(401);

    render(<SessionEndedNotice />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('does not take a wrong token at sign-in for an ended session', async () => {
    render(<SessionEndedNotice />);
    fetchMock.mockReturnValueOnce(answer(401));

    await act(() => login('the-wrong-token').catch(() => {}));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
