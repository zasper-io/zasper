import { atom } from 'jotai';

import { DiffTarget } from '@/api';

import { restoreTabs, restoredActive, type StoredTabs } from './tabStorage';

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
   * Never read in this window: set on restored tabs, cleared when one is first brought to the front.
   *
   * Absent means loaded, and that polarity is load-bearing — a "has loaded" flag would be absent on
   * every tab built elsewhere, and `withActive` would re-read the file over the reader's edits.
   */
  unloaded?: boolean;
}

export interface FileTabDict {
  [id: string]: FileTab;
}

/**
 * One half of a split: its own tabs, and its own tab in front. A file may be open in more than one
 * half, so the dictionary keyed by path is one *per half*; inside a half the path is still the key.
 *
 * There is one half today — the panes and the second strip are work still to come.
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
 * Brings one tab to the front, and asks it to load if it never has. A pure function so `openTab` and
 * `activateTab` cannot drift apart; an unknown path is a no-op rather than an invented tab.
 */
export function withActive(tabs: FileTabDict, path: string): FileTabDict {
  const target = tabs[path];
  if (target === undefined) {
    return tabs;
  }

  const next: FileTabDict = {};
  // `load_required` is a pulse: true for the tab about to read itself, cleared everywhere else.
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

/** The halves a remembered strip describes, or the Launcher alone when there is none. */
export function rememberedGroups(record: StoredTabs | null): TabGroup[] {
  if (record === null) {
    return [{ id: FIRST_GROUP, tabs: defaultFileTabState }];
  }
  return record.groups.map((group, index) => {
    // The Launcher goes to the first half, which is the one that always exists.
    const restored = restoreTabs(group, index === 0 ? defaultFileTabState.Launcher : undefined);
    return {
      id: index === 0 ? FIRST_GROUP : `group-${index + 1}`,
      tabs: withActive(restored, restoredActive(group, restored)),
    };
  });
}

/**
 * Every half, left to right. It starts as the Launcher alone: only `/api/info` can say which project
 * this is, and `useRememberTabs` restores that project's strip once it has. A strip seeded from the
 * last visit mounted the other project's notebook, which started a kernel for its path here.
 */
export const tabGroupsAtom = atom<TabGroup[]>(rememberedGroups(null));

/** The half with the cursor in it, which is the one every surface outside the panes reads. */
export const focusedGroupAtom = atom<string>(FIRST_GROUP);

/** One half's tabs, or an empty strip for a half that is not there. */
export function groupTabs(groups: TabGroup[], id: string): FileTabDict {
  return groups.find((group) => group.id === id)?.tabs ?? {};
}

/** The focused half's tabs, read and written as one dictionary: "the tabs" means the half in use. */
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
 * `tabs` without `paths`, and with something still in front. Shared by closing tabs and by deleting a
 * file out of every half, which owe the same answer.
 */
export function withoutTabs(tabs: FileTabDict, paths: string[], focus?: string): FileTabDict {
  const next: FileTabDict = {};
  Object.entries(tabs).forEach(([key, tab]) => {
    if (!paths.includes(key)) {
      next[key] = { ...tab, load_required: false };
    }
  });

  // Something has to be in front: the tab the close was measured from, or the Launcher.
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
