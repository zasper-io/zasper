import { atom } from 'jotai';

import { DiffTarget } from '@/api';

import { readStoredTabs, restoreTabs, restoredActive } from './tabStorage';

export interface FileTab {
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

export interface FileTabDict {
  [id: string]: FileTab;
}

/**
 * One half of a split: its own tabs, and its own tab in front.
 *
 * Story 16 settled VS Code's model, where a file can be open in more than one half — so two tabs about
 * one path cannot share a key, and the one dictionary keyed by path had to become one *per half*.
 * Inside a half the path is still the key, which is what keeps `withActive`, the close scopes and the
 * strip's own order exactly as they were.
 *
 * There is one half today. Nothing makes a second one yet: the panes, the second strip and the drag are
 * story 16's own work, and this is only the store underneath them.
 */
export interface TabGroup {
  /** Minted when the half is made, and what a tab's half is named by. */
  id: string;
  tabs: FileTabDict;
}

/** The half every session starts with, and the only one until the panes are built. */
export const FIRST_GROUP = 'group-1';

export const defaultFileTabState: FileTabDict = {
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
export function withActive(tabs: FileTabDict, path: string): FileTabDict {
  const target = tabs[path];
  if (target === undefined) {
    return tabs;
  }

  const next: FileTabDict = {};
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
 * Every half, left to right, seeded from the last visit.
 *
 * Read at module load, as `zoomLevelAtom` reads its own stored value: `App.tsx` mounts a bare
 * `<Provider>`, so this initial value is what the first render draws and the tabs are on screen
 * before any request goes out.
 *
 * It is seeded optimistically — nothing here can tell which project this server is serving, since
 * that takes `/api/info`. `useRememberTabs` does the confirming, and drops the strip when the answer
 * names a different directory than the one the record was written for.
 *
 * A test that wants the default strip has to seed its own store (`Provider` in src/testing), or clear
 * storage and `vi.resetModules()` before importing this: the seed happens on import, once.
 */
const remembered = readStoredTabs();

/** Which project the seeded strip was remembered for, for `useRememberTabs` to confirm. */
export const rememberedDirectory: string | null = remembered?.directory ?? null;

function seededGroups(): TabGroup[] {
  if (remembered === null) {
    return [{ id: FIRST_GROUP, tabs: defaultFileTabState }];
  }
  return remembered.groups.map((group, index) => {
    // The Launcher goes to the first half, which is the one that always exists.
    const restored = restoreTabs(group, index === 0 ? defaultFileTabState.Launcher : undefined);
    return {
      id: index === 0 ? FIRST_GROUP : `group-${index + 1}`,
      tabs: withActive(restored, restoredActive(group, restored)),
    };
  });
}

export const tabGroupsAtom = atom<TabGroup[]>(seededGroups());

/**
 * The half with the cursor in it. Everything outside the panes reads this one: the strip, the status
 * bar, the breadcrumb, the file browser's marker, the palette, the unsaved prompt.
 */
export const focusedGroupAtom = atom<string>(FIRST_GROUP);

/** One half's tabs, or an empty strip for a half that is not there. */
export function groupTabs(groups: TabGroup[], id: string): FileTabDict {
  return groups.find((group) => group.id === id)?.tabs ?? {};
}

/**
 * The focused half's tabs, read and written as one dictionary.
 *
 * This is the seam: to everything above it, "the tabs" means the half being worked in, which is what
 * every one of those surfaces already meant when there was only one. Writing it writes that half.
 */
export const fileTabsAtom = atom(
  (get) => groupTabs(get(tabGroupsAtom), get(focusedGroupAtom)),
  (get, set, update: FileTabDict | ((previous: FileTabDict) => FileTabDict)) => {
    const focused = get(focusedGroupAtom);
    set(tabGroupsAtom, (groups) =>
      groups.map((group) =>
        group.id === focused
          ? { ...group, tabs: typeof update === 'function' ? update(group.tabs) : update }
          : group
      )
    );
  }
);

/** The path of the tab in front, for the surfaces outside the tab strip that mark it — the file browser. */
export const activeTabPathAtom = atom<string>((get) => {
  const active = Object.values(get(fileTabsAtom)).find((tab) => tab.active);
  return active === undefined ? '' : active.path;
});

/**
 * `tabs` without `paths`, and with something still in front.
 *
 * Shared by closing tabs in one half and deleting a file out of every half: a half that loses the tab
 * it was showing has to show something, and which something is the same answer either way.
 */
export function withoutTabs(tabs: FileTabDict, paths: string[], focus?: string): FileTabDict {
  const next: FileTabDict = {};
  Object.entries(tabs).forEach(([key, tab]) => {
    if (!paths.includes(key)) {
      next[key] = { ...tab, load_required: false };
    }
  });

  // Something has to be in front once a tab goes: the tab a close was measured from if it stayed, or
  // the Launcher, the one tab always there. Only when the tab that went was the one in front, or
  // closing a background tab shows two.
  if (Object.values(next).some((tab) => tab.active)) {
    return next;
  }
  if (focus !== undefined && next[focus] !== undefined) {
    return withActive(next, focus);
  }
  if (next.Launcher) {
    next.Launcher = { ...next.Launcher, active: true };
  }
  return next;
}
