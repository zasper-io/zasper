import { atom } from 'jotai';

import { DiffTarget } from '@/api';

import { readStoredTabs, restoreTabs, restoredActive } from './TabStorage';

export interface IfileTab {
  type: string;
  path: string;
  name: string;
  active: boolean;
  extension: string | null;
  load_required: boolean;
  kernelspec: string;
  /** Terminals only: the folder the shell starts in, '' for the project root. */
  cwd?: string;
  /**
   * Diffs only: which comparison this tab is of.
   *
   * The file's own path is in here rather than in `path`, because `path` is the key a tab is stored
   * under: a diff sharing it would be the same tab as the editor for the same file.
   */
  diff?: DiffTarget;
  /**
   * This tab's content has never been read in this window: set on the tabs restored from a previous
   * session, and cleared the first time the tab is brought to the front, which is when it loads.
   *
   * Absent means loaded, and that polarity is load-bearing. A flag meaning "has loaded" would be
   * absent on every tab built anywhere but here — a fixture, a future caller — and `withActive`
   * would set `load_required` on it, which re-reads the file from disk and would throw away whatever
   * the reader had typed into a tab they merely switched away from and back to.
   *
   * Never persisted: what a tab holds is a fact about this window, not about the session that is
   * remembered.
   */
  unloaded?: boolean;
}

export interface IfileTabDict {
  [id: string]: IfileTab;
}

export const defaultFileTabState: IfileTabDict = {
  Launcher: {
    type: 'launcher',
    path: 'Launcher',
    name: 'Launcher',
    active: true,
    extension: 'txt',
    load_required: false,
    kernelspec: 'none',
  },
};

/**
 * Brings one tab to the front, and asks it to load if it never has.
 *
 * A pure function rather than a hook so that `openTab` and `activateTab` cannot drift apart: both
 * end here, which is what makes a restored tab load whether it is reached from the tab strip or from
 * the file browser. An unknown path is a no-op — every caller names a tab it is rendering — rather
 * than an invented tab, which is what the tab strip used to do.
 */
export function withActive(tabs: IfileTabDict, path: string): IfileTabDict {
  const target = tabs[path];
  if (target === undefined) {
    return tabs;
  }

  const next: IfileTabDict = {};
  // Only one tab is in front, and `load_required` is a pulse: it is true for the tab about to read
  // itself and false everywhere else, so it has to be cleared on the way past.
  Object.entries(tabs).forEach(([key, tab]) => {
    next[key] = { ...tab, active: false, load_required: false };
  });
  next[path] = {
    ...target,
    active: true,
    load_required: target.unloaded === true,
    unloaded: false,
  };
  return next;
}

/**
 * The strip, seeded from the last visit.
 *
 * Read at module load, as `zoomLevelAtom` reads its own stored value: `App.tsx` mounts a bare
 * `<Provider>`, so this initial value is what the first render draws and the tabs are on screen
 * before any request goes out.
 *
 * It is seeded optimistically — nothing here can tell which project this server is serving, since
 * that takes `/api/info`. `useRememberTabs` does the confirming, and drops the strip when the answer
 * names a different directory than the one the record was written for.
 *
 * A test that wants the default strip has to pass `initialValues` to its own `<Provider>`, or clear
 * storage and `vi.resetModules()` before importing this: the seed happens on import, once.
 */
const remembered = readStoredTabs();

/** Which project the seeded strip was remembered for, for `useRememberTabs` to confirm. */
export const rememberedDirectory: string | null = remembered?.directory ?? null;

function seededTabs(): IfileTabDict {
  if (remembered === null) {
    return defaultFileTabState;
  }
  const restored = restoreTabs(remembered, defaultFileTabState.Launcher);
  return withActive(restored, restoredActive(remembered, restored));
}

export const fileTabsAtom = atom<IfileTabDict>(seededTabs());

/** The path of the tab in front, for the surfaces outside the tab strip that mark it — the file browser. */
export const activeTabPathAtom = atom<string>((get) => {
  const active = Object.values(get(fileTabsAtom)).find((tab) => tab.active);
  return active === undefined ? '' : active.path;
});
