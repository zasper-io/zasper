import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';

import { SaveTab, unsavedTabsAtom, useUnsavedChanges } from './UnsavedState';

// A fresh jotai store per test: the map is global, so a tab one test registered would otherwise
// still be unsaved in the next.
const wrapper = ({ children }: { children: React.ReactNode }) => <Provider>{children}</Provider>;

/** Declares a tab's state and exposes the map back, as the tab bar reads it. */
function useHarness(path: string, unsaved: boolean, save: SaveTab) {
  useUnsavedChanges(path, unsaved, save);
  return useAtomValue(unsavedTabsAtom);
}

const noSave: SaveTab = () => Promise.resolve();

describe('useUnsavedChanges', () => {
  it('offers a way to save a tab that has changes the file does not', async () => {
    const save = vi.fn(noSave);
    const { result } = renderHook(() => useHarness('notes.txt', true, save), { wrapper });

    expect(Object.keys(result.current)).toEqual(['notes.txt']);
    await act(async () => {
      await result.current['notes.txt']();
    });
    expect(save).toHaveBeenCalledOnce();
  });

  it('says nothing about a tab that matches the file on disk', () => {
    const { result } = renderHook(() => useHarness('notes.txt', false, noSave), { wrapper });

    expect(result.current).toEqual({});
  });

  it('withdraws the tab once its changes have been saved', () => {
    const { result, rerender } = renderHook(
      ({ unsaved }: { unsaved: boolean }) => useHarness('notes.txt', unsaved, noSave),
      { wrapper, initialProps: { unsaved: true } }
    );
    expect(Object.keys(result.current)).toEqual(['notes.txt']);

    rerender({ unsaved: false });

    expect(result.current).toEqual({});
  });

  it('withdraws the tab when its editor unmounts', () => {
    const seen: string[][] = [];

    const Observer = () => {
      seen.push(Object.keys(useAtomValue(unsavedTabsAtom)));
      return null;
    };
    const Editor = () => {
      useUnsavedChanges('notes.txt', true, noSave);
      return null;
    };

    const { rerender } = render(
      <Provider>
        <Observer />
        <Editor />
      </Provider>
    );
    expect(seen[seen.length - 1]).toEqual(['notes.txt']);

    // The observer stays mounted, so it sees the map once the editor is gone.
    rerender(
      <Provider>
        <Observer />
      </Provider>
    );
    expect(seen[seen.length - 1]).toEqual([]);
  });

  // An editor hands over a new closure on every keystroke; writing each one to the atom would
  // re-render the tab bar per character.
  it('does not rewrite the map as the document keeps changing', () => {
    const { result, rerender } = renderHook(
      () => useHarness('notes.txt', true, () => Promise.resolve()),
      { wrapper }
    );

    const afterRegistration = result.current;
    rerender();
    rerender();

    expect(result.current).toBe(afterRegistration);
  });

  it('saves what the editor holds now, not what it held when it registered', async () => {
    const first = vi.fn(noSave);
    const second = vi.fn(noSave);
    const { result, rerender } = renderHook(
      ({ save }: { save: SaveTab }) => useHarness('notes.txt', true, save),
      { wrapper, initialProps: { save: first } }
    );

    rerender({ save: second });
    await act(async () => {
      await result.current['notes.txt']();
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
