import { useEffect, useRef } from 'react';
import { atom, useSetAtom } from 'jotai';

/** Writes an editor's current contents to disk, rejecting if the write failed. */
export type SaveTab = () => Promise<void>;

/**
 * How to save each unsaved tab, keyed by tab path — a tab appears here exactly while it is unsaved.
 * An atom because the tab bar is what has to ask, and it sits outside the tab tree; the save
 * function comes along because only the editor knows what to write.
 */
export const unsavedTabsAtom = atom<Record<string, SaveTab>>({});

/**
 * Declares from inside an editor whether its tab is unsaved, and how to save it.
 *
 * `save` is a new closure on every keystroke, so what is registered is a stable function reading the
 * latest one through a ref: the atom is written only when `unsaved` itself changes, rather than
 * re-rendering the tab bar per character.
 */
export function useUnsavedChanges(path: string, unsaved: boolean, save: SaveTab): void {
  const setUnsavedTabs = useSetAtom(unsavedTabsAtom);
  const latest = useRef(save);
  latest.current = save;

  useEffect(() => {
    if (!unsaved) {
      return;
    }

    const saveThisTab: SaveTab = () => latest.current();
    setUnsavedTabs((previous) => ({ ...previous, [path]: saveThisTab }));

    return () => {
      setUnsavedTabs((previous) => {
        // Only our own entry: a tab reopened at the same path may already have registered its own,
        // and it must not be withdrawn by the editor that is going away.
        if (previous[path] !== saveThisTab) {
          return previous;
        }
        const next = { ...previous };
        delete next[path];
        return next;
      });
    };
  }, [path, unsaved, setUnsavedTabs]);
}
