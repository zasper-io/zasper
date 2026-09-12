// What survives a visit and what deliberately does not. The assertions on the written JSON are the
// excluded-fields contract: a tab's kernel, its load pulse and a terminal's folder are not the strip.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgetTabs,
  readStoredTabs,
  rememberTabs,
  restoredActive,
  restoreTabs,
  StoredTabs,
} from './TabStorage';
import { defaultFileTabState, IfileTab, IfileTabDict, withActive } from './TabState';

const KEY = 'zasper.tabs';
const DIRECTORY = '/Users/x/work/demo';

function tab(path: string, type = 'file', extra: Partial<IfileTab> = {}): IfileTab {
  return {
    type,
    path,
    name: path.split('/').pop() ?? path,
    active: false,
    extension: 'txt',
    load_required: false,
    kernelspec: 'none',
    ...extra,
  };
}

const launcher = defaultFileTabState.Launcher;

// Exactly one tab is in front, as the strip always has it.
const open: IfileTabDict = {
  Launcher: { ...launcher, active: false },
  'notes.txt': tab('notes.txt'),
  'src/demo.ipynb': tab('src/demo.ipynb', 'notebook', { active: true, kernelspec: 'python3' }),
  'Terminal 1': tab('Terminal 1', 'terminal', { cwd: 'src' }),
};

function written(): StoredTabs {
  return JSON.parse(localStorage.getItem(KEY) ?? 'null');
}

function store(record: unknown): void {
  localStorage.setItem(KEY, JSON.stringify(record));
}

/** A record of the shape the writer produces, so a test can vary one part of it. */
function record(over: Partial<StoredTabs> = {}): StoredTabs {
  return {
    version: 1,
    directory: DIRECTORY,
    active: 'notes.txt',
    tabs: [
      { type: 'file', path: 'notes.txt', name: 'notes.txt', extension: 'txt' },
      { type: 'notebook', path: 'src/demo.ipynb', name: 'demo.ipynb', extension: 'ipynb' },
    ],
    ...over,
  };
}

describe('the remembered tab strip', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the open tabs in order, and which was in front', () => {
    rememberTabs(DIRECTORY, open);

    expect(written().directory).toBe(DIRECTORY);
    expect(written().active).toBe('src/demo.ipynb');
    expect(written().tabs.map((stored) => stored.path)).toEqual(['notes.txt', 'src/demo.ipynb']);
  });

  // A shell cannot be reattached, so a restored terminal would be an empty one wearing an old name.
  it('does not remember terminals, or the Launcher', () => {
    rememberTabs(DIRECTORY, open);

    const paths = written().tabs.map((stored) => stored.path);
    expect(paths).not.toContain('Terminal 1');
    expect(paths).not.toContain('Launcher');
  });

  it('remembers the Launcher being in front, without remembering the tab', () => {
    rememberTabs(DIRECTORY, {
      ...open,
      Launcher: { ...launcher, active: true },
      'src/demo.ipynb': tab('src/demo.ipynb', 'notebook'),
    });

    expect(written().active).toBe('Launcher');
    expect(written().tabs.map((stored) => stored.path)).not.toContain('Launcher');
  });

  /*
   * `load_required` is a pulse, not a property; a kernel name goes stale and is outranked by whatever
   * is running the path; and a terminal's folder is for a tab kind that is not remembered at all.
   */
  it('remembers nothing about a tab beyond what it takes to open it again', () => {
    rememberTabs(DIRECTORY, open);

    written().tabs.forEach((stored) => {
      expect(Object.keys(stored).sort()).toEqual(['extension', 'name', 'path', 'type']);
    });
  });

  it('keeps a diff tab whole, including which comparison it was', () => {
    const target = { path: 'notes.txt', staged: true, ref: 'abc1234', from: 'old.txt' };
    rememberTabs(DIRECTORY, {
      Launcher: launcher,
      'diff:abc1234:notes.txt': tab('diff:abc1234:notes.txt', 'diff', { diff: target }),
    });

    expect(written().tabs[0].diff).toEqual(target);
  });

  it('reads back a record it wrote', () => {
    rememberTabs(DIRECTORY, open);

    const read = readStoredTabs();
    expect(read?.directory).toBe(DIRECTORY);
    expect(read?.tabs.map((stored) => stored.path)).toEqual(['notes.txt', 'src/demo.ipynb']);
  });

  it('forgets on request', () => {
    rememberTabs(DIRECTORY, open);
    forgetTabs();

    expect(readStoredTabs()).toBeNull();
  });

  it('restores nothing when there is nothing to restore', () => {
    expect(readStoredTabs()).toBeNull();
  });

  it.each([
    ['unparseable', 'not json at all'],
    ['a version this code does not know', JSON.stringify(record({ version: 2 }))],
    ['no directory', JSON.stringify({ version: 1, active: 'a', tabs: [] })],
    ['tabs that are not a list', JSON.stringify({ ...record(), tabs: 'notes.txt' })],
  ])('restores nothing from a record with %s', (_label, raw) => {
    localStorage.setItem(KEY, raw);

    expect(readStoredTabs()).toBeNull();
  });

  it.each([
    [
      'a kind it does not restore',
      { type: 'terminal', path: 'Terminal 1', name: 'Terminal 1', extension: null },
    ],
    ['no path', { type: 'file', path: '', name: 'notes.txt', extension: 'txt' }],
    ['the Launcher key', { type: 'file', path: 'Launcher', name: 'Launcher', extension: 'txt' }],
    [
      'a diff with no target',
      { type: 'diff', path: 'diff:worktree:notes.txt', name: 'notes.txt (diff)', extension: 'txt' },
    ],
  ])('drops a stored tab with %s', (_label, entry) => {
    store(record({ tabs: [entry as never] }));

    expect(readStoredTabs()?.tabs).toEqual([]);
  });

  // A strip left open for a month is a real cost at the next boot: ContentPanel mounts every tab.
  it('restores no more than twenty-five tabs', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      type: 'file',
      path: `file-${index}.txt`,
      name: `file-${index}.txt`,
      extension: 'txt',
    }));
    store(record({ tabs: many }));

    expect(readStoredTabs()?.tabs).toHaveLength(25);
  });

  it('says nothing and breaks nothing when storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => rememberTabs(DIRECTORY, open)).not.toThrow();
    expect(readStoredTabs()).toBeNull();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

/** What TabState's seed does: rebuild the strip, then bring the remembered tab to the front. */
function seeded(from: StoredTabs = record()): IfileTabDict {
  const tabs = restoreTabs(from, launcher);
  return withActive(tabs, restoredActive(from, tabs));
}

describe('restoring a strip from a record', () => {
  beforeEach(() => localStorage.clear());

  it('puts the Launcher in front of the remembered tabs, in their order', () => {
    expect(Object.keys(seeded())).toEqual(['Launcher', 'notes.txt', 'src/demo.ipynb']);
  });

  /*
   * The whole point of restoring lazily: the strip comes back, but only the tab in front reads
   * itself, so a session of notebooks does not start a kernel each at boot.
   */
  it('reads only the tab that was in front, and marks the rest unread', () => {
    const tabs = seeded();

    expect(tabs['notes.txt'].active).toBe(true);
    expect(tabs['notes.txt'].load_required).toBe(true);
    expect(tabs['notes.txt'].unloaded).toBe(false);

    expect(tabs['src/demo.ipynb'].active).toBe(false);
    expect(tabs['src/demo.ipynb'].load_required).toBe(false);
    expect(tabs['src/demo.ipynb'].unloaded).toBe(true);
  });

  it('brings the Launcher forward when the tab that was in front is not restored', () => {
    const tabs = seeded(record({ active: 'Terminal 1' }));

    expect(tabs.Launcher.active).toBe(true);
    expect(Object.values(tabs).filter((restored) => restored.active)).toHaveLength(1);
  });

  it('gives a restored notebook no kernel name, leaving it to the one running the path', () => {
    expect(seeded()['src/demo.ipynb'].kernelspec).toBe('none');
  });
});
