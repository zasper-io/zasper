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
import { useRememberTabs } from './useRememberTabs';

const KEY = 'zasper.tabs';
const DIRECTORY = '/Users/x/work/demo';

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

function stored(): {
  version?: number;
  groups?: { active: string; tabs: { path: string }[] }[];
  tabs?: { path: string }[];
} | null {
  return JSON.parse(localStorage.getItem(KEY) ?? 'null');
}

/** The tabs remembered for the first half, which is the only one there is. */
function storedPaths(): string[] | undefined {
  return stored()?.groups?.[0].tabs.map((tab) => tab.path);
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
    expect(stored()?.groups?.[0].active).toBe('notes.txt');
  });

  it('remembers a strip when nothing was remembered before', () => {
    renderStrip(DIRECTORY);

    expect(storedPaths()).toEqual(['notes.txt']);
  });

  /*
   * Two projects served on the same port are one origin, so one store. A strip remembered for the
   * other one is dropped rather than adopted — its paths mean nothing here.
   */
  it('drops a strip remembered for another project', () => {
    store(remembered);
    mocked.rememberedDirectory = '/Users/x/work/other';

    renderStrip(DIRECTORY);

    expect(screen.getByTestId('tabs').textContent).toBe('Launcher');
    expect(storedPaths()).toEqual([]);
  });
});
