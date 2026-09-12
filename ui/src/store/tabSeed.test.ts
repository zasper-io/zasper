/*
 * The strip a visit starts with.
 *
 * TabState reads the remembered strip when it is imported, once, so each case arranges storage and
 * then imports the module fresh and reads the atom's own initial value. No React and no mocks here:
 * `vi.resetModules()` has to actually re-evaluate the module, which a mocked one would not, and
 * rendering under a re-imported jotai would put a second copy of React beneath the renderer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'zasper.tabs';

const remembered = {
  version: 1,
  directory: '/Users/x/work/demo',
  active: 'notes.txt',
  tabs: [
    { type: 'file', path: 'notes.txt', name: 'notes.txt', extension: 'txt' },
    { type: 'notebook', path: 'src/demo.ipynb', name: 'demo.ipynb', extension: 'ipynb' },
  ],
};

/** The strip TabState seeds itself with, for whatever is in storage now. */
async function seededStrip() {
  vi.resetModules();
  const fresh = await import('./TabState');
  return fresh.fileTabsAtom.init;
}

describe('the strip a visit starts with', () => {
  beforeEach(() => localStorage.clear());

  it('comes back in order, with the tab that was in front in front', async () => {
    localStorage.setItem(KEY, JSON.stringify(remembered));

    const strip = await seededStrip();

    expect(Object.keys(strip)).toEqual(['Launcher', 'notes.txt', 'src/demo.ipynb']);
    expect(strip['notes.txt'].active).toBe(true);
    // Only the tab in front reads itself; the notebook behind it starts no kernel.
    expect(strip['notes.txt'].load_required).toBe(true);
    expect(strip['src/demo.ipynb'].load_required).toBe(false);
    expect(strip['src/demo.ipynb'].unloaded).toBe(true);
  });

  it('remembers which project it came from, for the boot to confirm', async () => {
    localStorage.setItem(KEY, JSON.stringify(remembered));

    vi.resetModules();
    const fresh = await import('./TabState');

    expect(fresh.rememberedDirectory).toBe('/Users/x/work/demo');
  });

  it('is the Launcher alone when nothing was remembered', async () => {
    expect(Object.keys(await seededStrip())).toEqual(['Launcher']);
  });

  it('is the Launcher alone when what was remembered cannot be read', async () => {
    localStorage.setItem(KEY, '{ not json');

    expect(Object.keys(await seededStrip())).toEqual(['Launcher']);
  });

  it('does not restore a terminal', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...remembered,
        active: 'Terminal 1',
        tabs: [{ type: 'terminal', path: 'Terminal 1', name: 'Terminal 1', extension: null }],
      })
    );

    const strip = await seededStrip();

    expect(Object.keys(strip)).toEqual(['Launcher']);
    expect(strip.Launcher.active).toBe(true);
  });
});
