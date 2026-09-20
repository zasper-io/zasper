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
 * Why a folder has no rows: empty, not read yet, unreadable, or filtered down to nothing — four
 * states that otherwise render alike, as nothing at all.
 */
export default function TreeStatus({ path, visible }: TreeStatusProps) {
  const { childrenOf, hasRead, isLoading } = useFileTree();
  const filter = useAtomValue(treeFilterAtom).trim();

  if (visible > 0) {
    return null;
  }
  if (isLoading(path) && !hasRead(path)) {
    return (
      <li className="z-note">
        <span className="z-spinner" />
        Loading…
      </li>
    );
  }
  if (!hasRead(path)) {
    // The message strip above says what the server said; this only says that the tree is not it.
    return <li className="z-note">Could not be read</li>;
  }
  if (childrenOf(path).length > 0) {
    // There is something here, and the reader's own settings are why it cannot be seen.
    return <li className="z-note">{filter === '' ? 'Only hidden files' : 'No matches here'}</li>;
  }

  return <li className="z-note">Empty</li>;
}
