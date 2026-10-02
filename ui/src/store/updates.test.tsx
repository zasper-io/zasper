import React from 'react';
import { act, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateStatus } from '@/api';
import { projectDirAtom } from '@/store/serverInfo';
import { fileTabsAtom } from '@/store/tabState';
import { WHATS_NEW_TAB_KEY } from '@/store/tabActions';
import { describeUpdateCheck, showsUpdate, useUpdates } from './updates';

const getUpdateStatus = vi.fn();

vi.mock('@/api', () => ({
  getUpdateStatus: () => getUpdateStatus(),
  deleteKernel: vi.fn(),
  logApiError: () => () => {},
}));

const available: UpdateStatus = {
  version: '1.1.0',
  checks: true,
  latest: { version: '2.0.0', date: '2026-09-22', notes: 'https://zasper.io/changelog#2.0.0' },
  available: true,
  major: true,
  security: false,
  checked_at: '2026-10-02T10:00:00Z',
  whats_new: false,
};

describe('showsUpdate', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');

  it('names a newer release', () => {
    expect(showsUpdate(available, null, now)).toBe(true);
  });

  it('says nothing when there is nothing newer, or in the snap', () => {
    expect(showsUpdate({ ...available, available: false }, null, now)).toBe(false);
    expect(showsUpdate({ ...available, checks: false }, null, now)).toBe(false);
    expect(showsUpdate(null, null, now)).toBe(false);
  });

  it('stays hidden until the next version', () => {
    expect(showsUpdate(available, { version: '2.0.0' }, now)).toBe(false);
    const next = { ...available, latest: { ...available.latest!, version: '2.0.1' } };
    expect(showsUpdate(next, { version: '2.0.0' }, now)).toBe(true);
  });

  it('hides a security update only until the day is out', () => {
    const security = { ...available, security: true };
    expect(showsUpdate(security, { version: '2.0.0', until: now + 1 }, now)).toBe(false);
    expect(showsUpdate(security, { version: '2.0.0', until: now }, now)).toBe(true);
  });
});

describe('describeUpdateCheck', () => {
  const now = new Date('2026-10-02T12:00:00Z');

  it('says what the last check found, and when', () => {
    expect(describeUpdateCheck(available, now)).toBe('2.0.0 is available. Checked 2 hours ago.');
    expect(describeUpdateCheck({ ...available, available: false, major: false }, now)).toBe(
      'This is the newest version. Checked 2 hours ago.'
    );
  });

  it('says when the check failed, keeping what it last learned', () => {
    expect(describeUpdateCheck({ ...available, error: 'no such host' }, now)).toBe(
      'Could not reach zasper.io. 2.0.0 is available. Checked 2 hours ago.'
    );
  });

  it('says the snap updates itself, and when nothing has been checked yet', () => {
    expect(describeUpdateCheck({ ...available, checks: false }, now)).toBe(
      'Installed as a snap, which keeps itself up to date.'
    );
    expect(
      describeUpdateCheck({ ...available, checked_at: undefined, latest: undefined }, now)
    ).toBe('Not checked yet.');
  });
});

function Updates() {
  useUpdates();
  return null;
}

describe('useUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens What's new once the project is known, and only once", async () => {
    getUpdateStatus.mockResolvedValue({ ...available, whats_new: true });
    const store = createStore();
    render(
      <Provider store={store}>
        <Updates />
      </Provider>
    );
    await act(async () => {});
    expect(store.get(fileTabsAtom)[WHATS_NEW_TAB_KEY]).toBeUndefined();

    act(() => store.set(projectDirAtom, '/work/rig'));
    expect(store.get(fileTabsAtom)[WHATS_NEW_TAB_KEY]?.active).toBe(true);

    act(() => {
      const { [WHATS_NEW_TAB_KEY]: _closed, ...rest } = store.get(fileTabsAtom);
      store.set(fileTabsAtom, { ...rest, Launcher: { ...rest.Launcher, active: true } });
    });
    act(() => store.set(projectDirAtom, '/work/other'));
    expect(store.get(fileTabsAtom)[WHATS_NEW_TAB_KEY]).toBeUndefined();
  });

  it("does not open What's new when its notes have been shown", async () => {
    getUpdateStatus.mockResolvedValue(available);
    const store = createStore();
    store.set(projectDirAtom, '/work/rig');
    render(
      <Provider store={store}>
        <Updates />
      </Provider>
    );
    await act(async () => {});
    expect(store.get(fileTabsAtom)[WHATS_NEW_TAB_KEY]).toBeUndefined();
  });
});
