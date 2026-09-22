/*
 * Keeping the remembered strip in step with the open one.
 *
 * The directory the seeded strip came from is settled when TabState is imported, so it is mocked
 * here rather than arranged through storage. Seeding itself is tabSeed.test.ts, which has to
 * re-import TabState for real and therefore cannot mock it.
 */
import { render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { Provider } from '@/testing/Provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectDirAtom } from '@/store/serverInfo';
import { defaultFileTabState, fileTabsAtom } from './tabState';
import { readStoredTabs } from './tabStorage';
import { useRememberTabs } from './useRememberTabs';

const KEY = 'zasper.tabs';
const DIRECTORY = '/Users/x/work/demo';
const OTHER = '/Users/x/work/other';

/** The directory the seeded strip was remembered for, which TabState reads once at import. */
const mocked = vi.hoisted(() => ({ rememberedDirectory: null as string | null }));

vi.mock('./tabState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tabState')>();
  return {
    ...actual,
    get rememberedDirectory() {
      return mocked.rememberedDirectory;
    },
  };
});

const remembered = {
  version: 1,
  directory: DIRECTORY,
  active: 'notes.txt',
  tabs: [
    { type: 'file', path: 'notes.txt', name: 'notes.txt', extension: 'txt' },
    { type: 'notebook', path: 'src/demo.ipynb', name: 'demo.ipynb', extension: 'ipynb' },
  ],
};

function store(record: unknown): void {
  localStorage.setItem(KEY, typeof record === 'string' ? record : JSON.stringify(record));
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

/** `directory` is what `/api/info` answered, or '' while it has not answered yet. */
function renderStrip(directory: string) {
  return render(
    <Provider
      initialValues={[
        [projectDirAtom, directory],
        [
          fileTabsAtom,
          {
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
          },
        ],
      ]}
    >
      <Harness />
    </Provider>
  );
}

describe('keeping the record in step', () => {
  beforeEach(() => {
    localStorage.clear();
    mocked.rememberedDirectory = null;
  });

  // A boot that never learns which project it is looking at must not overwrite a good record.
  it('writes nothing until the project directory is known', () => {
    store(remembered);
    mocked.rememberedDirectory = DIRECTORY;

    renderStrip('');

    expect(stored()).toEqual(remembered);
  });

  it('writes the strip once the directory confirms the project', () => {
    store(remembered);
    mocked.rememberedDirectory = DIRECTORY;

    renderStrip(DIRECTORY);

    expect(storedPaths()).toEqual(['notes.txt']);
    expect(readStoredTabs(DIRECTORY)?.groups[0].active).toBe('notes.txt');
  });

  it('remembers a strip when nothing was remembered before', () => {
    renderStrip(DIRECTORY);

    expect(storedPaths()).toEqual(['notes.txt']);
  });

  /*
   * Two projects served on the same port are one origin, so one store. A strip remembered for the
   * other one is not adopted — its paths mean nothing here — and not thrown away either.
   */
  it('shows this project its own strip, and keeps the other project’s', () => {
    const elsewhere = { type: 'file', path: 'elsewhere.py', name: 'elsewhere.py', extension: 'py' };
    store({
      version: 3,
      last: OTHER,
      projects: {
        [DIRECTORY]: { used: 1, groups: [{ active: 'notes.txt', tabs: remembered.tabs }] },
        [OTHER]: { used: 2, groups: [{ active: 'elsewhere.py', tabs: [elsewhere] }] },
      },
    });
    mocked.rememberedDirectory = OTHER;

    renderStrip(DIRECTORY);

    expect(screen.getByTestId('tabs').textContent).toBe('Launcher,notes.txt,src/demo.ipynb');
    expect(storedPaths(OTHER)).toEqual(['elsewhere.py']);
  });

  it('shows the Launcher alone for a project with nothing remembered', () => {
    store({ ...remembered, directory: OTHER });
    mocked.rememberedDirectory = OTHER;

    renderStrip('/Users/x/work/new');

    expect(screen.getByTestId('tabs').textContent).toBe('Launcher');
    expect(storedPaths('/Users/x/work/new')).toEqual([]);
    expect(storedPaths(OTHER)).toEqual(['notes.txt', 'src/demo.ipynb']);
  });
});
