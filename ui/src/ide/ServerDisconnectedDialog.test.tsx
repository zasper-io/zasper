import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ServerDisconnectedDialog from './ServerDisconnectedDialog';
import { checkServer, serverAnswered } from './serverConnection';

const serverAnswers = vi.fn();
const getInfo = vi.fn();

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  serverAnswers: () => serverAnswers(),
  getInfo: () => getInfo(),
}));

async function serverIs(up: boolean) {
  serverAnswers.mockResolvedValue(up);
  await act(async () => {
    await checkServer();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  serverAnswers.mockReset();
  getInfo.mockReset().mockResolvedValue({});
  serverAnswered();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ServerDisconnectedDialog', () => {
  it('says nothing while the server answers', () => {
    render(<ServerDisconnectedDialog />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says so when the server stops answering, and closes when it is back', async () => {
    render(<ServerDisconnectedDialog />);

    await serverIs(false);
    expect(screen.getByRole('dialog')).toHaveTextContent('Server disconnected');
    expect(screen.getByRole('dialog')).toHaveTextContent('Unsaved changes stay in this tab.');

    await serverIs(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps checking while the server is gone', async () => {
    render(<ServerDisconnectedDialog />);
    await serverIs(false);
    serverAnswers.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(serverAnswers).toHaveBeenCalledOnce();
  });

  it('asks whether the session survived once the server is back', async () => {
    render(<ServerDisconnectedDialog />);
    await serverIs(false);

    await serverIs(true);

    expect(getInfo).toHaveBeenCalledOnce();
  });

  it('stays dismissed for this outage, and comes back for the next', async () => {
    render(<ServerDisconnectedDialog />);
    await serverIs(false);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await serverIs(false);
    expect(screen.queryByRole('dialog')).toBeNull();

    await serverIs(true);
    await serverIs(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
