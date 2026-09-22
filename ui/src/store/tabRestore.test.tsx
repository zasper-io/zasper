/*
 * Restoring a project's strip once the project is known, and keeping the record in step after.
 *
 * Seeding itself is tabSeed.test.ts, which re-imports TabState for real.
 */
import { render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { Provider } from '@/testing/Provider';
import { beforeEach, describe, expect, it } from 'vitest';

import { projectDirAtom } from '@/store/serverInfo';
import { defaultFileTabState, fileTabsAtom, FileTabDict } from './tabState';
import { readStoredTabs } from './tabStorage';
import { useRememberTabs } from './useRememberTabs';

const KEY = 'zasper.tabs';
const DIRECTORY = '/Users/x/work/demo';
const OTHER = '/Users/x/work/other';

const notebookTabs = [
  { type: 'file', path: 'notes.txt', name: 'notes.txt', extension: 'txt' },
  { type: 'notebook', path: 'src/demo.ipynb', name: 'demo.ipynb', extension: 'ipynb' },
];

/** A record holding a strip for each of `projects`, as version 3 writes it. */
function store(projects: Record<string, typeof notebookTabs>): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      version: 3,
      projects: Object.fromEntries(
        Object.entries(projects).map(([directory, tabs], index) => [
          directory,
          { used: index, groups: [{ active: tabs[tabs.length - 1].path, tabs }] },
        ])
      ),
    })
  );
}

function stored(): unknown {
  return JSON.parse(localStorage.getItem(KEY) ?? 'null');
}

/** The tabs remembered for a project's first half, which is the only one there is. */
function storedPaths(directory = DIRECTORY): string[] | undefined {
  return readStoredTabs(directory)?.groups[0].tabs.map((tab) => tab.path);
}

/** The strip on screen, and the hook that remembers it. */
function Harness() {
  useRememberTabs();
  const tabs = useAtomValue(fileTabsAtom);
  return <span data-testid="tabs">{Object.keys(tabs).join(',')}</span>;
}

/** A strip with a file already open in it, as if someone opened one before `/api/info` answered. */
const withNotes: FileTabDict = {
  ...defaultFileTabState,
  Launcher: { ...defaultFileTabState.Launcher, active: false },
  'notes.txt': {
    type: 'file',
    path: 'notes.txt',
    name: 'notes.txt',
    active: true,
    extension: 'txt',
    load_required: false,
    kernelspec: 'none',
  },
};

/** `directory` is what `/api/info` answered, or '' while it has not answered yet. */
function renderStrip(directory: string, tabs: FileTabDict = defaultFileTabState) {
  return render(
    <Provider
      initialValues={[
        [projectDirAtom, directory],
        [fileTabsAtom, tabs],
      ]}
    >
      <Harness />
    </Provider>
  );
}

function strip(): string | null {
  return screen.getByTestId('tabs').textContent;
}

describe('restoring the strip', () => {
  beforeEach(() => localStorage.clear());

  // Nothing another project left behind is mounted, so no notebook of its starts a kernel here.
  it('shows the Launcher alone, and writes nothing, until the project directory is known', () => {
    store({ [OTHER]: notebookTabs });
    const before = stored();

    renderStrip('');

    expect(strip()).toBe('Launcher');
    expect(stored()).toEqual(before);
  });

  it('restores this project’s strip once the directory arrives, and keeps the other’s', () => {
    const elsewhere = [
      { type: 'file', path: 'elsewhere.py', name: 'elsewhere.py', extension: 'py' },
    ];
    store({ [DIRECTORY]: notebookTabs, [OTHER]: elsewhere });

    renderStrip(DIRECTORY);

    expect(strip()).toBe('Launcher,notes.txt,src/demo.ipynb');
    expect(storedPaths()).toEqual(['notes.txt', 'src/demo.ipynb']);
    expect(storedPaths(OTHER)).toEqual(['elsewhere.py']);
  });

  it('shows the Launcher alone for a project with nothing remembered', () => {
    store({ [OTHER]: notebookTabs });

    renderStrip('/Users/x/work/new');

    expect(strip()).toBe('Launcher');
    expect(storedPaths('/Users/x/work/new')).toEqual([]);
    expect(storedPaths(OTHER)).toEqual(['notes.txt', 'src/demo.ipynb']);
  });

  it('keeps a tab opened before the directory arrived, rather than replacing it', () => {
    store({ [DIRECTORY]: notebookTabs });

    renderStrip(DIRECTORY, withNotes);

    expect(strip()).toBe('Launcher,notes.txt');
    expect(storedPaths()).toEqual(['notes.txt']);
    expect(readStoredTabs(DIRECTORY)?.groups[0].active).toBe('notes.txt');
  });

  it('remembers a strip when nothing was remembered before', () => {
    renderStrip(DIRECTORY, withNotes);

    expect(storedPaths()).toEqual(['notes.txt']);
  });
});
