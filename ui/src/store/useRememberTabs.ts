import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { projectDirAtom } from '@/store/serverInfo';
import { rememberedGroups, tabGroupsAtom, type TabGroup } from './tabState';
import { readStoredTabs, rememberTabs } from './tabStorage';

/**
 * Restores this project's strip once `/api/info` has said which project it is, then keeps the
 * remembered strip in step with the open one.
 *
 * Mounted once, from IDE.tsx, the way `useApplyZoom` is. No debounce: `fileTabsAtom` changes only
 * when a tab is opened, closed, renamed or brought to the front, so this writes once per deliberate
 * act. Typing does not reach it — an editor's text is its own state, and whether a tab is dirty
 * lives in `unsavedTabsAtom`. A per-keystroke field on a tab, a cursor or a scroll position, would
 * change that and would need a debounce.
 *
 * Nothing is read or written until the directory arrives, as with recent files: two projects served
 * on the same port are the same origin, so the same storage, and a tab mounted from the wrong
 * project's strip is a notebook whose kernel starts for a path that means something else here. So a
 * boot whose `/api/info` never answers also leaves what was remembered untouched.
 */
export function useRememberTabs(): void {
  const groups = useAtomValue(tabGroupsAtom);
  const directory = useAtomValue(projectDirAtom);
  const setGroups = useSetAtom(tabGroupsAtom);
  const restored = useRef(false);

  useEffect(() => {
    if (directory === '') {
      return;
    }

    // Both in one effect, in this order: a separate effect for the write could store the Launcher
    // alone over this project's strip before the restore had run. A tab opened before the directory
    // arrived is kept rather than replaced, and is what gets remembered.
    if (!restored.current) {
      restored.current = true;
      const stored = readStoredTabs(directory);
      if (stored !== null && launcherOnly(groups)) {
        setGroups(rememberedGroups(stored));
        // The write for the restored strip comes on the next run, from the state change above.
        return;
      }
    }

    rememberTabs(directory, groups);
  }, [directory, groups, setGroups]);
}

function launcherOnly(groups: TabGroup[]): boolean {
  return groups.length === 1 && Object.keys(groups[0].tabs).join() === 'Launcher';
}
