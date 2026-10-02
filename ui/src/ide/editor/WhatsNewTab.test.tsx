import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateStatus, WhatsNew } from '@/api';
import { FileTab } from '@/store/tabState';
import { updateStatusAtom } from '@/store/updates';
import WhatsNewTab, { releaseDate } from './WhatsNewTab';

const getWhatsNew = vi.fn();
const markWhatsNewSeen = vi.fn();

vi.mock('@/api', () => ({
  getWhatsNew: () => getWhatsNew(),
  markWhatsNewSeen: () => markWhatsNewSeen(),
  logApiError: () => () => {},
}));
vi.mock('./notebook/MarkdownRenderer', () => ({
  default: ({ source }: { source: string }) => <div className="zasper-markdown">{source}</div>,
}));

const tab: FileTab = {
  type: 'whats-new',
  path: 'zasper:whats-new',
  name: "What's New",
  active: true,
  extension: null,
  load_required: false,
  kernelspec: 'none',
};

async function renderTab(notes: WhatsNew) {
  getWhatsNew.mockResolvedValue(notes);
  const store = createStore();
  store.set(updateStatusAtom, { whats_new: true } as UpdateStatus);
  render(
    <Provider store={store}>
      <WhatsNewTab data={tab} />
    </Provider>
  );
  await act(async () => {});
  return store;
}

describe('WhatsNewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markWhatsNewSeen.mockResolvedValue(undefined);
  });

  it("shows this version's notes, and records them as shown", async () => {
    const store = await renderTab({
      version: '2.0.0',
      from: '1.1.0',
      sections: [{ version: '2.0.0', date: '2026-09-22', markdown: '### Added' }],
    });

    expect(screen.getByRole('heading', { name: 'Zasper 2.0.0' })).not.toBeNull();
    expect(screen.getByText('22 September 2026 · you were on 1.1.0')).not.toBeNull();
    expect(screen.getByText('### Added')).not.toBeNull();
    expect(markWhatsNewSeen).toHaveBeenCalledOnce();
    expect(store.get(updateStatusAtom)?.whats_new).toBe(false);
  });

  it('shows every version that was skipped, newest first', async () => {
    await renderTab({
      version: '2.0.0',
      from: '1.0.0',
      sections: [
        { version: '2.0.0', date: '2026-09-22', markdown: 'two' },
        { version: '1.1.0', date: '2026-09-14', markdown: 'one point one' },
      ],
    });

    expect(screen.getByRole('heading', { name: /Zasper 1\.1\.0/ })).not.toBeNull();
    const notes = [...document.querySelectorAll('.zasper-markdown')].map((n) => n.textContent);
    expect(notes).toEqual(['two', 'one point one']);
  });

  it('opens a link in the notes in a new browser tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await renderTab({
      version: '2.0.0',
      sections: [{ version: '2.0.0', date: '2026-09-22', markdown: 'notes' }],
    });
    const link = document.createElement('a');
    link.href = 'https://github.com/zasper-io/zasper/blob/v2.0.0/docs/API.md';
    document.querySelector('.zasper-markdown')!.append(link);

    expect(fireEvent.click(link)).toBe(false);
    expect(open).toHaveBeenCalledWith(link.href, '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('says so when this version has no notes', async () => {
    await renderTab({ version: 'unknown', sections: [] });
    expect(screen.getByText('There are no release notes for unknown.')).not.toBeNull();
  });
});

describe('releaseDate', () => {
  it('writes the date the way the changelog is read', () => {
    expect(releaseDate('2026-09-22')).toBe('22 September 2026');
    expect(releaseDate('2025-05-03')).toBe('3 May 2025');
    expect(releaseDate('soon')).toBe('soon');
  });
});
