/**
 * The open tabs, remembered between visits.
 *
 * Closing the browser tab used to lose the strip: reopening Zasper left a lone Launcher and the
 * reader opening half a dozen files again by hand. Nothing else is lost by a reload — a reopened
 * notebook rejoins its running kernel by path — so the list of what was open is the whole gap.
 *
 * In localStorage rather than `~/.zasper/config.json`, following `themes/index.ts` and `zoom/`: the
 * strip belongs to the window looking at the project. Every access is wrapped, and a read that
 * cannot be trusted answers `null`: a remembered tab strip is not worth failing a boot over.
 *
 * Two windows on one server both write here and the last writer wins. That is felt only at the next
 * boot, which restores whichever window last changed its strip; mirroring two live strips would be a
 * feature rather than a fix.
 *
 * What is deliberately not remembered:
 *   - terminals, which cannot be reattached — every connection spawns a new shell, so a restored
 *     terminal is an empty one wearing an old name;
 *   - the Launcher, which is the default state and has to exist whatever is stored;
 *   - `load_required`, a pulse meaning "read yourself now" rather than anything about a tab;
 *   - `kernelspec`, which goes stale, and which the kernel already running that path outranks;
 *   - unsaved edits. Those live in the editors' own state and cannot come back, so a restored tab is
 *     the file as it is on disk.
 */
import type { DiffTarget } from '@/api';

// Types only, deliberately: TabState seeds itself from this module, so a value imported back the
// other way would be a runtime cycle between the two.
import type { IfileTab, IfileTabDict } from './TabState';

const STORAGE_KEY = 'zasper.tabs';

/** Bumped when the record's shape changes; an older or newer one is ignored rather than guessed at. */
const VERSION = 1;

/**
 * A bound on what one boot will mount. `ContentPanel` mounts every open tab, restored or not, so a
 * strip remembered from a session someone left open for a month is a real cost at the next boot.
 */
const MAX_TABS = 25;

/** The tab kinds worth restoring: the ones that are a file on disk, or a comparison of one. */
const RESTORABLE = new Set(['file', 'notebook', 'diff']);

/** One remembered tab. A subset of IfileTab: what it takes to open the same thing again. */
export interface StoredTab {
  type: string;
  path: string;
  name: string;
  extension: string | null;
  /** Diffs only, and the reason a diff can be restored at all: which comparison it was. */
  diff?: DiffTarget;
}

export interface StoredTabs {
  version: number;
  /** The absolute project directory, from `/api/info`, so another project's tabs are not adopted. */
  directory: string;
  /** The key of the tab that was in front. */
  active: string;
  /** In strip order. An array, not the keyed dictionary: order is the point of remembering. */
  tabs: StoredTab[];
}

function isStorable(tab: IfileTab): boolean {
  return RESTORABLE.has(tab.type) && tab.path !== 'Launcher';
}

/** Reads back what was remembered, or `null` when there is nothing trustworthy to restore. */
export function readStoredTabs(): StoredTabs | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage turned off.
    return null;
  }
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const record = parsed as Partial<StoredTabs>;
  if (
    record === null ||
    typeof record !== 'object' ||
    record.version !== VERSION ||
    typeof record.directory !== 'string' ||
    record.directory === '' ||
    !Array.isArray(record.tabs)
  ) {
    return null;
  }

  const tabs = record.tabs.filter((tab): tab is StoredTab => {
    if (tab === null || typeof tab !== 'object') {
      return false;
    }
    const { type, path, name, diff } = tab as StoredTab;
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
  });

  return {
    version: VERSION,
    directory: record.directory,
    active: typeof record.active === 'string' ? record.active : 'Launcher',
    tabs: tabs.slice(0, MAX_TABS),
  };
}

/** Remembers the strip as it now stands, for the project at `directory`. */
export function rememberTabs(directory: string, tabs: IfileTabDict): void {
  const record: StoredTabs = {
    version: VERSION,
    directory,
    active: Object.values(tabs).find((tab) => tab.active)?.path ?? 'Launcher',
    tabs: Object.values(tabs)
      .filter(isStorable)
      .slice(0, MAX_TABS)
      .map((tab) => ({
        type: tab.type,
        path: tab.path,
        name: tab.name,
        extension: tab.extension,
        ...(tab.diff === undefined ? {} : { diff: tab.diff }),
      })),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // A full quota, or storage turned off. The strip is still on screen; only the memory of it is lost.
  }
}

/** Forgets the strip, for when what was remembered belongs to another project. */
export function forgetTabs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do about it, and nothing depends on it having worked.
  }
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
export function restoreTabs(record: StoredTabs, launcher: IfileTab): IfileTabDict {
  const tabs: IfileTabDict = { Launcher: { ...launcher, active: false, load_required: false } };

  record.tabs.forEach((stored) => {
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
export function restoredActive(record: StoredTabs, tabs: IfileTabDict): string {
  return tabs[record.active] === undefined ? 'Launcher' : record.active;
}
