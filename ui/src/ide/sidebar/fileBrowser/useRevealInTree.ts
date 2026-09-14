import { useSetAtom } from 'jotai';

import { isInside, parentDirOf } from '@/paths';
import { focusedPathAtom, treeFilterAtom } from './atoms';
import { useTreeEdits } from './useFileTree';
import { useSelection } from './useSelection';
import { useTreeRoot } from './useTreeRoot';

/**
 * Shows a file's row in the tree: opens every folder above it, then selects the row and puts the
 * keyboard on it, which scrolls it into view. The filter and a narrowed root would each hide the row,
 * so both give way.
 */
export function useRevealInTree(): (path: string) => Promise<void> {
  const { expand } = useTreeEdits();
  const { root, openAsRoot } = useTreeRoot();
  const selection = useSelection();
  const setFocusedPath = useSetAtom(focusedPathAtom);
  const setFilter = useSetAtom(treeFilterAtom);

  return async (path: string) => {
    setFilter('');
    const base = root !== '' && isInside(path, root) ? root : '';
    if (base !== root) {
      openAsRoot('');
    }

    const folders: string[] = [];
    for (let dir = parentDirOf(path); dir !== base; dir = parentDirOf(dir)) {
      folders.unshift(dir);
    }
    // Outermost first: a folder's row only exists once the folder above it is open.
    for (const folder of folders) {
      await expand(folder);
    }

    selection.select(path);
    setFocusedPath(path);
  };
}
