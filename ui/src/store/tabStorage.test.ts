// What survives a visit and what deliberately does not. The assertions on the written JSON are the
// excluded-fields contract: a tab's kernel, its load pulse and a terminal's folder are not the strip.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readStoredTabs,
  rememberTabs,
  restoredActive,
  restoreTabs,
  StoredGroup,
  StoredTabs,
} from './tabStorage';
import { defaultFileTabState, FileTab, FileTabDict, withActive } from './tabState';

const KEY = 'zasper.tabs';
const DIRECTORY = '/Users/x/work/demo';

function tab(path: string, type = 'file', extra: Partial<FileTab> = {}): FileTab {
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
const open: FileTabDict = {
  Launcher: { ...launcher, active: false },
  'notes.txt': tab('notes.txt'),
  'src/demo.ipynb': tab('src/demo.ipynb', 'notebook', { active: true, kernelspec: 'python3' }),
  'Terminal 1': tab('Terminal 1', 'terminal', { cwd: 'src' }),
};

/** The strip written for `directory`, as it sits in storage. */
function written(directory = DIRECTORY): StoredTabs {
  const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  return { version: raw.version, directory, groups: raw.projects[directory].groups };
}

/** The one half every case here is about, as the writer is handed it. */
function halves(tabs: FileTabDict = open) {
  return [{ id: 'group-1', tabs }];
}

/** The tabs remembered for one half, by path. */
function writtenPaths(half = 0): string[] {
  return written().groups[half].tabs.map((stored) => stored.path);
}

function store(record: unknown): void {
  localStorage.setItem(KEY, JSON.stringify(record));
}

/** A half of the shape the writer produces, so a test can vary one part of it. */
function storedGroup(over: Partial<StoredGroup> = {}): StoredGroup {
  return {
    active: 'notes.txt',
    tabs: [
      { type: 'file', path: 'notes.txt', name: 'notes.txt', extension: 'txt' },
      { type: 'notebook', path: 'src/demo.ipynb', name: 'demo.ipynb', extension: 'ipynb' },
    ],
    ...over,
  };
}

/** A record of the shape the writer produces, so a test can vary one part of it. */
function record(over: Partial<StoredGroup> = {}): StoredTabs {
  return { version: 2, directory: DIRECTORY, groups: [storedGroup(over)] };
}

describe('the remembered tab strip', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the open tabs in order, and which was in front', () => {
    rememberTabs(DIRECTORY, halves());

    expect(Object.keys(JSON.parse(localStorage.getItem(KEY) ?? 'null').projects)).toEqual([
      DIRECTORY,
    ]);
    expect(written().groups[0].active).toBe('src/demo.ipynb');
    expect(writtenPaths()).toEqual(['notes.txt', 'src/demo.ipynb']);
  });

  // Each half keeps its own tabs and its own tab in front, which is the whole of what a split adds.
  it('remembers every half, and what was in front of each', () => {
    rememberTabs(DIRECTORY, [
      { id: 'group-1', tabs: open },
      { id: 'group-2', tabs: { 'lib/clean.py': tab('lib/clean.py', 'file', { active: true }) } },
    ]);

    expect(written().groups).toHaveLength(2);
    expect(written().groups[1].active).toBe('lib/clean.py');
    expect(writtenPaths(1)).toEqual(['lib/clean.py']);
  });

  // A shell cannot be reattached, so a restored terminal would be an empty one wearing an old name.
  it('does not remember terminals, or the Launcher', () => {
    rememberTabs(DIRECTORY, halves());

    expect(writtenPaths()).not.toContain('Terminal 1');
    expect(writtenPaths()).not.toContain('Launcher');
  });

  it('remembers the Launcher being in front, without remembering the tab', () => {
    rememberTabs(
      DIRECTORY,
      halves({
        ...open,
        Launcher: { ...launcher, active: true },
        'src/demo.ipynb': tab('src/demo.ipynb', 'notebook'),
      })
    );

    expect(written().groups[0].active).toBe('Launcher');
    expect(writtenPaths()).not.toContain('Launcher');
  });

  /*
   * `load_required` is a pulse, not a property; a kernel name goes stale and is outranked by whatever
   * is running the path; and a terminal's folder is for a tab kind that is not remembered at all.
   */
  it('remembers nothing about a tab beyond what it takes to open it again', () => {
    rememberTabs(DIRECTORY, halves());

    written().groups[0].tabs.forEach((stored) => {
      expect(Object.keys(stored).sort()).toEqual(['extension', 'name', 'path', 'type']);
    });
  });

  it('keeps a diff tab whole, including which comparison it was', () => {
    const target = { path: 'notes.txt', staged: true, ref: 'abc1234', from: 'old.txt' };
    rememberTabs(
      DIRECTORY,
      halves({
        Launcher: launcher,
        'diff:abc1234:notes.txt': tab('diff:abc1234:notes.txt', 'diff', { diff: target }),
      })
    );

    expect(written().groups[0].tabs[0].diff).toEqual(target);
  });

  it('reads back a record it wrote', () => {
    rememberTabs(DIRECTORY, halves());

    const read = readStoredTabs(DIRECTORY);
    expect(read?.directory).toBe(DIRECTORY);
    expect(read?.groups[0].tabs.map((stored) => stored.path)).toEqual([
      'notes.txt',
      'src/demo.ipynb',
    ]);
  });

  /*
   * Version 1 was one strip, before there could be halves. It is read as one half rather than thrown
   * away: an upgrade should not cost somebody the tabs they had open.
   */
  it('reads a record from before the split as one half', () => {
    store({
      version: 1,
      directory: DIRECTORY,
      active: 'notes.txt',
      tabs: [{ type: 'file', path: 'notes.txt', name: 'notes.txt', extension: 'txt' }],
    });

    const read = readStoredTabs(DIRECTORY);

    expect(read?.groups).toHaveLength(1);
    expect(read?.groups[0].active).toBe('notes.txt');
    expect(read?.groups[0].tabs.map((stored) => stored.path)).toEqual(['notes.txt']);
  });

  // Two projects served on one port share a store; opening the second must not cost the first its tabs.
  it('keeps each project its own strip', () => {
    rememberTabs(DIRECTORY, halves());
    rememberTabs('/Users/x/work/other', halves({ Launcher: launcher, 'b.py': tab('b.py') }));

    expect(readStoredTabs(DIRECTORY)?.groups[0].tabs.map((stored) => stored.path)).toEqual([
      'notes.txt',
      'src/demo.ipynb',
    ]);
    expect(
      readStoredTabs('/Users/x/work/other')?.groups[0].tabs.map((stored) => stored.path)
    ).toEqual(['b.py']);
  });

  it('carries a record from before projects were kept apart into the new shape', () => {
    store(record());
    rememberTabs('/Users/x/work/other', halves());

    expect(readStoredTabs(DIRECTORY)?.groups[0].active).toBe('notes.txt');
  });

  it('remembers no more than twenty projects, dropping the least recently used', () => {
    for (let index = 0; index < 25; index++) {
      vi.spyOn(Date, 'now').mockReturnValue(index);
      rememberTabs(`/work/project-${index}`, halves());
    }
    vi.restoreAllMocks();

    expect(readStoredTabs('/work/project-4')).toBeNull();
    expect(readStoredTabs('/work/project-5')).not.toBeNull();
    expect(readStoredTabs('/work/project-24')).not.toBeNull();
  });

  it('restores nothing for a project it has no strip for', () => {
    rememberTabs(DIRECTORY, halves());

    expect(readStoredTabs('/Users/x/work/other')).toBeNull();
  });

  it('restores nothing when there is nothing to restore', () => {
    expect(readStoredTabs(DIRECTORY)).toBeNull();
  });

  it.each([
    ['unparseable', 'not json at all'],
    [
      'a version this code does not know',
      JSON.stringify({ version: 9, directory: DIRECTORY, groups: [storedGroup()] }),
    ],
    ['no directory', JSON.stringify({ version: 2, groups: [storedGroup()] })],
    ['halves that are not a list', JSON.stringify({ ...record(), groups: 'notes.txt' })],
    ['no halves at all', JSON.stringify({ version: 2, directory: DIRECTORY, groups: [] })],
  ])('restores nothing from a record with %s', (_label, raw) => {
    localStorage.setItem(KEY, raw);

    expect(readStoredTabs(DIRECTORY)).toBeNull();
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

    expect(readStoredTabs(DIRECTORY)?.groups[0].tabs).toEqual([]);
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

    expect(readStoredTabs(DIRECTORY)?.groups[0].tabs).toHaveLength(25);
  });

  // The same bound on halves, for a hand-edited record: four panes is already more than a window holds.
  it('restores no more than four halves', () => {
    store({
      version: 2,
      directory: DIRECTORY,
      groups: Array.from({ length: 9 }, () => storedGroup()),
    });

    expect(readStoredTabs(DIRECTORY)?.groups).toHaveLength(4);
  });

  it('says nothing and breaks nothing when storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => rememberTabs(DIRECTORY, halves())).not.toThrow();
    expect(readStoredTabs(DIRECTORY)).toBeNull();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

/** What TabState's seed does: rebuild the strip, then bring the remembered tab to the front. */
function seeded(from: StoredTabs = record()): FileTabDict {
  const tabs = restoreTabs(from.groups[0], launcher);
  return withActive(tabs, restoredActive(from.groups[0], tabs));
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

  // The Launcher is the tab that is always open, not one per pane, so only the first half gets it.
  it('gives a second half no Launcher of its own', () => {
    const tabs = restoreTabs(storedGroup({ active: 'notes.txt' }));

    expect(Object.keys(tabs)).toEqual(['notes.txt', 'src/demo.ipynb']);
    expect(restoredActive(storedGroup({ active: 'Terminal 1' }), tabs)).toBe('notes.txt');
  });
});

describe('the Help tab', () => {
  it('is remembered with the strip, and restored under the key it had', () => {
    const helpTab = tab('zasper:help', 'help', { name: 'Help', extension: null });
    rememberTabs(DIRECTORY, halves({ ...open, 'zasper:help': helpTab }));
    expect(writtenPaths()).toContain('zasper:help');

    const read = readStoredTabs(DIRECTORY);
    expect(read).not.toBeNull();
    const restored = restoreTabs((read as StoredTabs).groups[0], launcher);
    expect(restored['zasper:help']).toMatchObject({ type: 'help', name: 'Help' });
  });
});
