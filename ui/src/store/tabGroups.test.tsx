/*
 * The halves, and the seam above them.
 *
 * Story 16 settled VS Code's model, where a file can be open in more than one half — so the open tabs
 * became one dictionary per half rather than one for the window. Nothing makes a second half yet;
 * these are the rules the panes will be built on, and the proof that one half behaves exactly as the
 * single strip always did.
 */
import { act, render, screen } from '@testing-library/react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Provider } from '@/testing/Provider';
import { useTabActions } from './tabActions';
import {
  activeTabPathAtom,
  defaultFileTabState,
  FileTab,
  fileTabsAtom,
  FIRST_GROUP,
  focusedGroupAtom,
  tabGroupsAtom,
  withoutTabs,
} from './tabState';

vi.mock('@/api', () => ({ deleteKernel: vi.fn(), logApiError: () => () => {} }));

function tab(path: string, over: Partial<FileTab> = {}): FileTab {
  return {
    type: 'file',
    path,
    name: path.split('/').pop() ?? path,
    active: false,
    extension: 'py',
    load_required: false,
    kernelspec: 'none',
    ...over,
  };
}

const halves = [
  {
    id: FIRST_GROUP,
    tabs: {
      Launcher: { ...defaultFileTabState.Launcher, active: false },
      'a.py': tab('a.py', { active: true }),
    },
  },
  { id: 'group-2', tabs: { 'a.py': tab('a.py'), 'b.py': tab('b.py', { active: true }) } },
];

/** What the surfaces outside the panes see, and the halves underneath them. */
function Harness() {
  const [tabs, setTabs] = useAtom(fileTabsAtom);
  const groups = useAtomValue(tabGroupsAtom);
  const setFocused = useSetAtom(focusedGroupAtom);
  const activePath = useAtomValue(activeTabPathAtom);
  const { openTab, renameTab, closeDeleted } = useTabActions();

  return (
    <div>
      <span data-testid="strip">{Object.keys(tabs).join(',')}</span>
      <span data-testid="active">{activePath}</span>
      <span data-testid="halves">
        {groups.map((group) => `${group.id}[${Object.keys(group.tabs).join(' ')}]`).join(',')}
      </span>
      <span data-testid="fronts">
        {groups
          .map(
            (group) =>
              `${group.id}:${Object.values(group.tabs).find((open) => open.active)?.path ?? '-'}`
          )
          .join(',')}
      </span>
      <button type="button" onClick={() => setFocused('group-2')}>
        focus the second half
      </button>
      <button type="button" onClick={() => openTab({ name: 'c.py', path: 'c.py', type: 'file' })}>
        open c.py
      </button>
      <button type="button" onClick={() => setTabs((previous) => withoutTabs(previous, ['a.py']))}>
        close a.py here
      </button>
      <button type="button" onClick={() => renameTab('a.py', 'moved.py')}>
        rename a.py
      </button>
      <button type="button" onClick={() => closeDeleted('a.py')}>
        delete a.py
      </button>
    </div>
  );
}

function renderHalves(groups = halves) {
  render(
    <Provider initialValues={[[tabGroupsAtom, groups]]}>
      <Harness />
    </Provider>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe('the halves', () => {
  beforeEach(() => localStorage.clear());

  it('shows the focused half to everything above it', () => {
    renderHalves();

    expect(text('strip')).toBe('Launcher,a.py');
    expect(text('active')).toBe('a.py');
  });

  it('follows the focus to the other half, tabs and all', () => {
    renderHalves();

    act(() => screen.getByText('focus the second half').click());

    expect(text('strip')).toBe('a.py,b.py');
    expect(text('active')).toBe('b.py');
  });

  // "Exactly one tab is in front" is per half, not per window.
  it('keeps a tab in front of each half at once', () => {
    renderHalves();

    expect(text('fronts')).toBe('group-1:a.py,group-2:b.py');
  });

  // The same file in both halves is the whole reason the store changed shape.
  it('holds one file in two halves, under the path in each', () => {
    renderHalves();

    expect(text('halves')).toBe('group-1[Launcher a.py],group-2[a.py b.py]');
  });

  it('opens a tab into the focused half, and leaves the other alone', () => {
    renderHalves();
    act(() => screen.getByText('focus the second half').click());

    act(() => screen.getByText('open c.py').click());

    expect(text('halves')).toBe('group-1[Launcher a.py],group-2[a.py b.py c.py]');
    expect(text('active')).toBe('c.py');
  });

  it('closes a tab in one half without touching the same file in the other', () => {
    renderHalves();

    act(() => screen.getByText('close a.py here').click());

    expect(text('halves')).toBe('group-1[Launcher],group-2[a.py b.py]');
    // The half that lost the tab it was showing shows the Launcher instead.
    expect(text('fronts')).toBe('group-1:Launcher,group-2:b.py');
  });

  it('renames the file in every half it is open in', () => {
    renderHalves();

    act(() => screen.getByText('rename a.py').click());

    expect(text('halves')).toBe('group-1[Launcher moved.py],group-2[moved.py b.py]');
  });

  it('closes a deleted file out of every half', () => {
    renderHalves();

    act(() => screen.getByText('delete a.py').click());

    expect(text('halves')).toBe('group-1[Launcher],group-2[b.py]');
  });
});
