import { useAtom, useSetAtom } from 'jotai';

import { focusedPathAtom, treeRootAtom } from './atoms';
import { useSelection } from './useSelection';

export interface ITreeRoot {
  /** The folder the tree is rooted at; '' is the project root. */
  root: string;
  /** The trail from the project root down to it, as paths, innermost last. Empty at the project root. */
  trail: string[];
  /** Roots the tree at a folder, or at the project root when given ''. */
  openAsRoot: (path: string) => void;
}

/**
 * Where the tree is rooted, and how to move it. Reading the folder is left to the panel, which reads
 * its root whenever it changes — so this only has to say where to look.
 */
export function useTreeRoot(): ITreeRoot {
  const [root, setRoot] = useAtom(treeRootAtom);
  const setFocusedPath = useSetAtom(focusedPathAtom);
  const selection = useSelection();

  const trail: string[] = [];
  if (root !== '') {
    root.split('/').forEach((segment, index) => {
      trail.push(index === 0 ? segment : `${trail[index - 1]}/${segment}`);
    });
  }

  return {
    root,
    trail,
    openAsRoot: (path: string) => {
      if (path === root) {
        return;
      }
      setRoot(path);
      // Both are measured in rows that are about to be different ones, and a selection that cannot be
      // seen is a selection the next Delete would act on anyway.
      selection.clear();
      setFocusedPath('');
    },
  };
}
