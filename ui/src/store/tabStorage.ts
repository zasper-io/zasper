/**
 * The open tabs, remembered between visits: everything else survives a reload — a reopened notebook
 * rejoins its running kernel by path — so the list of what was open was the whole gap.
 *
 * In localStorage rather than ~/.zasper/config.json, as themes and zoom are: the strip belongs to the
 * window looking at the project. Every access is wrapped and an untrustworthy read answers `null`;
 * two windows on one project both write its entry and the last one wins, felt only at the next boot.
 *
 * Not remembered: terminals (a reattached shell is a new one wearing an old name), the Launcher
 * (always there), `load_required` (a pulse), `kernelspec` (the running kernel outranks it), and
 * unsaved edits, so a restored tab is the file as it is on disk.
 */
import type { DiffTarget } from '@/api';

import { projectEntry, readJSON, withProject, writeJSON } from './projectStorage';

// Types only, deliberately: TabState imports its restore helpers from this module, so a value imported
// back the other way would be a runtime cycle between the two.
import type { FileTab, FileTabDict, TabGroup } from './tabState';

const STORAGE_KEY = 'zasper.tabs';

/**
 * Bumped when the record's shape changes, and older ones are read rather than thrown away: an upgrade
 * should not cost anybody the tabs they had open. Version 1 was one strip, 2 one project's halves, and
 * 3 holds an entry per project. Anything else is ignored rather than guessed at.
 */
const VERSION = 3;

/**
 * A bound on what one boot will mount. `ContentPanel` mounts every open tab, restored or not, so a
 * strip remembered from a session someone left open for a month is a real cost at the next boot.
 */
const MAX_TABS = 25;

/** The same bound on halves, for a hand-edited record: four panes is already more than a window holds. */
const MAX_GROUPS = 4;

/** The tab kinds worth restoring: a file on disk, a git comparison of one, and Help and Settings, which are only themselves. */
const RESTORABLE = new Set(['file', 'notebook', 'diff', 'help', 'settings']);

/** One remembered tab. A subset of FileTab: what it takes to open the same thing again. */
export interface StoredTab {
  type: string;
  path: string;
  name: string;
  extension: string | null;
  /** Diffs only, and the reason a diff can be restored at all: which comparison it was. */
  diff?: DiffTarget;
}

/** One half's remembered tabs, in strip order, and which of them was in front. */
export interface StoredGroup {
  /** The key of the tab that was in front in this group. */
  active: string;
  /** In strip order. An array, not the keyed dictionary: order is the point of remembering. */
  tabs: StoredTab[];
}

/** One project's strip, as it is read back. */
export interface StoredTabs {
  version: number;
  /** The absolute project directory, from `/api/info`, so another project's tabs are not adopted. */
  directory: string;
  /** Left to right. One today — nothing makes a second half yet — and the shape is ready for more. */
  groups: StoredGroup[];
}

/** What is written: every project's halves. */
interface StoredProjects {
  version: number;
  projects: Record<string, { groups: StoredGroup[]; used: number }>;
}

function isStorable(tab: FileTab): boolean {
  return RESTORABLE.has(tab.type) && tab.path !== 'Launcher';
}

/** Every project's record, as version 3 whatever it was written as, or `null` when there is none. */
function readProjects(): StoredProjects | null {
  const parsed = readJSON(STORAGE_KEY);
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Partial<StoredProjects> & Partial<StoredTabs> & Partial<StoredGroup>;
  if (record.version === VERSION) {
    return record.projects !== null && typeof record.projects === 'object'
      ? (record as StoredProjects)
      : null;
  }

  if (typeof record.directory !== 'string' || record.directory === '') {
    return null;
  }
  const groups = legacyGroups(record);
  if (groups === null) {
    return null;
  }
  return {
    version: VERSION,
    projects: { [record.directory]: { groups, used: 0 } },
  };
}

/** The groups a version 1 or 2 record holds, or null for one to ignore. */
function legacyGroups(record: Partial<StoredTabs> & Partial<StoredGroup>): StoredGroup[] | null {
  if (record.version === 1 && Array.isArray(record.tabs)) {
    return [
      { active: typeof record.active === 'string' ? record.active : 'Launcher', tabs: record.tabs },
    ];
  }
  if (record.version === 2 && Array.isArray(record.groups)) {
    return record.groups;
  }
  return null;
}

/** Reads back the strip remembered for `directory`, or `null` when there is nothing trustworthy to restore. */
export function readStoredTabs(directory: string): StoredTabs | null {
  const stored = readProjects();
  if (stored === null) {
    return null;
  }

  const entry = projectEntry(stored.projects, directory) as { groups?: unknown } | undefined;
  if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.groups)) {
    return null;
  }
  const groups = (entry.groups as StoredGroup[]).filter(
    (group) => group !== null && typeof group === 'object'
  );
  if (groups.length === 0) {
    return null;
  }

  return {
    version: VERSION,
    directory,
    groups: groups.slice(0, MAX_GROUPS).map((group) => ({
      active: typeof group.active === 'string' ? group.active : 'Launcher',
      tabs: (Array.isArray(group.tabs) ? group.tabs : []).filter(isRestorable).slice(0, MAX_TABS),
    })),
  };
}

function isRestorable(tab: StoredTab): tab is StoredTab {
  if (tab === null || typeof tab !== 'object') {
    return false;
  }
  const { type, path, name, diff } = tab;
  if (typeof type !== 'string' || typeof path !== 'string' || typeof name !== 'string') {
    return false;
  }
  if (path === '' || name === '' || !RESTORABLE.has(type) || path === 'Launcher') {
    return false;
  }
  // A diff tab with no target renders as nothing at all — Editor.tsx has no diff to hand the
  // DiffTab — so it would come back as a tab that can never show anything.
  if (
    type === 'diff' &&
    (diff === null || typeof diff !== 'object' || typeof diff.path !== 'string')
  ) {
    return false;
  }
  return true;
}

/** Remembers the halves as they now stand, for the project at `directory`, beside every other project's. */
export function rememberTabs(directory: string, groups: TabGroup[]): void {
  const stored: StoredGroup[] = groups.map((group) => ({
    active: Object.values(group.tabs).find((tab) => tab.active)?.path ?? 'Launcher',
    tabs: Object.values(group.tabs)
      .filter(isStorable)
      .slice(0, MAX_TABS)
      .map((tab) => ({
        type: tab.type,
        path: tab.path,
        name: tab.name,
        extension: tab.extension,
        ...(tab.diff === undefined ? {} : { diff: tab.diff }),
      })),
  }));

  const record: StoredProjects = {
    version: VERSION,
    projects: withProject(readProjects()?.projects, directory, {
      groups: stored,
      used: Date.now(),
    }),
  };
  writeJSON(STORAGE_KEY, record);
}

/**
 * The tab dictionary a record describes, with the Launcher in front of it and nothing in front yet.
 *
 * Every restored tab is `unloaded`: on screen, never read, and reading itself the first time it is
 * brought to the front — so a session of ten notebooks does not start ten kernels at boot. Which tab
 * ends up in front is `withActive`'s to say, and `TabState` applies it to what this returns, so the
 * restored tab in front loads on exactly the terms every other activation uses.
 *
 * The Launcher is passed in rather than imported to keep this a function of its arguments — and to
 * keep the dependency between these two modules pointing one way.
 */
export function restoreTabs(group: StoredGroup, launcher?: FileTab): FileTabDict {
  // The Launcher belongs to the first half only: it is the tab that is always open, not one per pane.
  const tabs: FileTabDict =
    launcher === undefined
      ? {}
      : { Launcher: { ...launcher, active: false, load_required: false } };

  group.tabs.forEach((stored) => {
    tabs[stored.path] = {
      type: stored.type,
      path: stored.path,
      name: stored.name,
      extension: stored.extension,
      active: false,
      load_required: false,
      // Not remembered: a name from the last session starts nothing, and the kernel already running
      // this path is what a restored notebook joins.
      kernelspec: 'none',
      unloaded: true,
      ...(stored.diff === undefined ? {} : { diff: stored.diff }),
    };
  });

  return tabs;
}

/**
 * Which of the restored tabs should be in front: the one that was, or the Launcher when it is not
 * among them — the remembered tab may have been a terminal, or a shape this version no longer
 * restores. The Launcher is always there, so this always names a tab that exists.
 */
export function restoredActive(group: StoredGroup, tabs: FileTabDict): string {
  if (tabs[group.active] !== undefined) {
    return group.active;
  }
  // The Launcher is always in the first half, so it is always a tab that exists there; a later half
  // falls back to whatever it restored first.
  return tabs.Launcher === undefined ? (Object.keys(tabs)[0] ?? '') : 'Launcher';
}
