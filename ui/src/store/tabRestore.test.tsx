/*
 * Keeping the remembered strip in step with the open one.
 *
 * The directory the seeded strip came from is settled when TabState is imported, so it is mocked
 * here rather than arranged through storage. Seeding itself is tabSeed.test.ts, which has to
 * re-import TabState for real and therefore cannot mock it.
 */
import { render, screen } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectDirAtom } from './AppState';
import { defaultFileTabState, fileTabsAtom } from './TabState';
import { useRememberTabs } from './useRememberTabs';

const KEY = 'zasper.tabs';
const DIRECTORY = '/Users/x/work/demo';

/** The directory the seeded strip was remembered for, which TabState reads once at import. */
const mocked = vi.hoisted(() => ({ rememberedDirectory: null as string | null }));

vi.mock('./TabState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./TabState')>();
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

function stored(): { active?: string; tabs?: { path: string }[] } | null {
  return JSON.parse(localStorage.getItem(KEY) ?? 'null');
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

    expect(stored()?.tabs?.map((tab) => tab.path)).toEqual(['notes.txt']);
    expect(stored()?.active).toBe('notes.txt');
  });

  it('remembers a strip when nothing was remembered before', () => {
    renderStrip(DIRECTORY);

    expect(stored()?.tabs?.map((tab) => tab.path)).toEqual(['notes.txt']);
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
    expect(stored()?.tabs).toEqual([]);
  });
});
