import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { projectDirAtom } from './AppState';
import { defaultFileTabState, fileTabsAtom, rememberedDirectory } from './TabState';
import { forgetTabs, rememberTabs } from './TabStorage';

/**
 * Keeps the remembered strip in step with the open one, and confirms it belongs to this project.
 *
 * Mounted once, from IDE.tsx, the way `useApplyZoom` is. No debounce: `fileTabsAtom` changes only
 * when a tab is opened, closed, renamed or brought to the front, so this writes once per deliberate
 * act. Typing does not reach it — an editor's text is its own state, and whether a tab is dirty
 * lives in `unsavedTabsAtom`. A per-keystroke field on a tab, a cursor or a scroll position, would
 * change that and would need a debounce.
 *
 * The strip was seeded at module load, before anything knew which project this server serves. This
 * is where that is settled: the first run with a directory in hand compares it against the one the
 * record was written for, and a strip belonging to another project is dropped rather than adopted —
 * two projects served on the same port are the same origin, so the same storage.
 *
 * Nothing is written until that directory arrives, so a boot whose `/api/info` never answers leaves
 * what was remembered untouched rather than replacing it with a strip nobody confirmed.
 */
export function useRememberTabs(): void {
  const tabs = useAtomValue(fileTabsAtom);
  const directory = useAtomValue(projectDirAtom);
  const setTabs = useSetAtom(fileTabsAtom);
  const confirmed = useRef(false);

  useEffect(() => {
    if (directory === '') {
      return;
    }

    // Both in one effect, in this order: a separate effect for the check could write the wrong
    // project's strip back under this project's directory before running.
    if (!confirmed.current) {
      confirmed.current = true;
      if (rememberedDirectory !== null && rememberedDirectory !== directory) {
        forgetTabs();
        setTabs(defaultFileTabState);
        // The write for the reset strip comes on the next run, from the state change above.
        return;
      }
    }

    rememberTabs(directory, tabs);
  }, [directory, tabs, setTabs]);
}
