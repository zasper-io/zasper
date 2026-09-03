import { useAtomValue } from 'jotai';

import { treeFilterAtom } from './atoms';
import { useFileTree } from './useFileTree';

interface TreeStatusProps {
  /** The directory whose rows are missing. */
  path: string;
  /** How many of its rows survived the filter, which the caller has already worked out. */
  visible: number;
}

/**
 * Why a folder has no rows. An empty folder, a folder that has not been read yet, a folder that could
 * not be read and a filter that matched nothing all used to render as the same thing: nothing at all.
 */
export default function TreeStatus({ path, visible }: TreeStatusProps) {
  const { childrenOf, hasRead, isLoading } = useFileTree();
  const filter = useAtomValue(treeFilterAtom).trim();

  if (visible > 0) {
    return null;
  }
  if (isLoading(path) && !hasRead(path)) {
    return <li className="treeNote">Loading…</li>;
  }
  if (!hasRead(path)) {
    // The message strip above says what the server said; this only says that the tree is not it.
    return <li className="treeNote">Could not be read</li>;
  }
  if (childrenOf(path).length > 0) {
    // There is something here, and the reader's own settings are why it cannot be seen.
    return <li className="treeNote">{filter === '' ? 'Only hidden files' : 'No matches here'}</li>;
  }

  return <li className="treeNote">Empty</li>;
}
