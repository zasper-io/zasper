import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateStatus as Status } from '@/api';
import { hiddenUpdateAtom, updateStatusAtom } from '@/store/updates';
import UpdateStatus from './UpdateStatus';

const copyToClipboard = vi.fn();

vi.mock('@/browser', () => ({ copyToClipboard: (text: string) => copyToClipboard(text) }));
vi.mock('@/api', () => ({ logApiError: () => () => {} }));

const available: Status = {
  version: '1.1.0',
  checks: true,
  upgrade_command: 'brew upgrade zasper',
  latest: { version: '2.0.0', date: '2026-09-22', notes: 'https://zasper.io/changelog#2.0.0' },
  available: true,
  major: true,
  security: false,
  whats_new: false,
};

function renderItem(status: Status | null) {
  const store = createStore();
  store.set(updateStatusAtom, status);
  store.set(hiddenUpdateAtom, null);
  render(
    <Provider store={store}>
      <UpdateStatus />
    </Provider>
  );
  return store;
}

describe('UpdateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('says nothing when there is nothing newer', () => {
    renderItem({ ...available, available: false });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the release, and its menu says what it is and how to get it', () => {
    renderItem(available);
    fireEvent.click(screen.getByRole('button', { name: 'Zasper 2.0.0 is available' }));

    expect(screen.getByText('2.0.0 available', { exact: false })).not.toBeNull();
    expect(screen.getByText('Major')).not.toBeNull();
    expect(screen.getByText('22 September 2026 · you have 1.1.0')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Release notes' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Copy “brew upgrade zasper”' })).not.toBeNull();
  });

  it('offers no command for an install it cannot name', () => {
    renderItem({ ...available, upgrade_command: undefined, major: false });
    fireEvent.click(screen.getByRole('button', { name: 'Zasper 2.0.0 is available' }));

    expect(screen.queryByText('Major')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Copy/ })).toBeNull();
  });

  it('copies the command', async () => {
    copyToClipboard.mockResolvedValue(true);
    renderItem(available);
    fireEvent.click(screen.getByRole('button', { name: 'Zasper 2.0.0 is available' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy “brew upgrade zasper”' }));
    });
    expect(copyToClipboard).toHaveBeenCalledWith('brew upgrade zasper');
  });

  it('hides until the next version', () => {
    const store = renderItem(available);
    fireEvent.click(screen.getByRole('button', { name: 'Zasper 2.0.0 is available' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide until the next version' }));

    expect(screen.queryByRole('button')).toBeNull();
    expect(store.get(hiddenUpdateAtom)).toEqual({ version: '2.0.0', until: undefined });
    expect(JSON.parse(localStorage.getItem('zasper:update-hidden')!)).toEqual({ version: '2.0.0' });
  });

  it('calls a security update one, and hides it only until tomorrow', () => {
    const store = renderItem({ ...available, security: true });
    fireEvent.click(screen.getByRole('button', { name: 'Zasper 2.0.0 is a security update' }));
    expect(screen.getByText('Security update: 2.0.0', { exact: false })).not.toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide until tomorrow' }));

    expect(store.get(hiddenUpdateAtom)?.until).toBeGreaterThan(Date.now());
  });
});
