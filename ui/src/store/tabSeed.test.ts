/*
 * The strip a visit starts with, and the strip a remembered record turns into.
 *
 * TabState builds its atom when it is imported, once, so the first cases arrange storage and then
 * import the module fresh and read the atom's own initial value. No React and no mocks here:
 * `vi.resetModules()` has to actually re-evaluate the module, which a mocked one would not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rememberedGroups } from './tabState';
import { readStoredTabs } from './tabStorage';

const KEY = 'zasper.tabs';
const DIRECTORY = '/Users/x/work/demo';

const remembered = {
  version: 1,
  directory: DIRECTORY,
  active: 'src/demo.ipynb',
  tabs: [
    { type: 'file', path: 'notes.txt', name: 'notes.txt', extension: 'txt' },
    { type: 'notebook', path: 'src/demo.ipynb', name: 'demo.ipynb', extension: 'ipynb' },
  ],
};

/** The first half's tabs as TabState seeds them, for whatever is in storage now. */
async function seededStrip() {
  vi.resetModules();
  const fresh = await import('./tabState');
  return fresh.tabGroupsAtom.init[0].tabs;
}

/** The first half's tabs, as a record remembered for `DIRECTORY` restores them. */
function restoredStrip() {
  return rememberedGroups(readStoredTabs(DIRECTORY))[0].tabs;
}

describe('the strip a visit starts with', () => {
  beforeEach(() => localStorage.clear());

  /*
   * Only /api/info can say which project this is. Seeding from the last visit mounted that project's
   * notebook here, which started a kernel for its path in whatever folder this server was given.
   */
  it('is the Launcher alone even when a strip was remembered', async () => {
    localStorage.setItem(KEY, JSON.stringify(remembered));

    expect(Object.keys(await seededStrip())).toEqual(['Launcher']);
  });

  it('is the Launcher alone when nothing was remembered', async () => {
    expect(Object.keys(await seededStrip())).toEqual(['Launcher']);
  });
});

describe('a remembered strip, restored', () => {
  beforeEach(() => localStorage.clear());

  it('comes back in order, with the tab that was in front in front', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...remembered, active: 'notes.txt' }));

    const strip = restoredStrip();

    expect(Object.keys(strip)).toEqual(['Launcher', 'notes.txt', 'src/demo.ipynb']);
    expect(strip['notes.txt'].active).toBe(true);
    // Only the tab in front reads itself; the notebook behind it starts no kernel.
    expect(strip['notes.txt'].load_required).toBe(true);
    expect(strip['src/demo.ipynb'].load_required).toBe(false);
    expect(strip['src/demo.ipynb'].unloaded).toBe(true);
  });

  it('is one half, from a record written before there could be more', () => {
    localStorage.setItem(KEY, JSON.stringify(remembered));

    expect(rememberedGroups(readStoredTabs(DIRECTORY))).toHaveLength(1);
  });

  it('is the Launcher alone when what was remembered cannot be read', () => {
    localStorage.setItem(KEY, '{ not json');

    expect(Object.keys(restoredStrip())).toEqual(['Launcher']);
  });

  it('does not restore a terminal', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...remembered,
        active: 'Terminal 1',
        tabs: [{ type: 'terminal', path: 'Terminal 1', name: 'Terminal 1', extension: null }],
      })
    );

    const strip = restoredStrip();

    expect(Object.keys(strip)).toEqual(['Launcher']);
    expect(strip.Launcher.active).toBe(true);
  });
});
