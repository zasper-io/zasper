import { useCallback, useEffect, useState } from 'react';
import { useAtom } from 'jotai';

import { deleteRequestAtom, renameRequestAtom } from './atoms';
import { useContentActions } from './useContentActions';
import { useSelection } from './useSelection';

export interface IRowRename {
  isEditing: boolean;
  text: string;
  onChange: (text: string) => void;
  start: () => void;
  cancel: () => void;
  submit: () => Promise<void>;
}

/**
 * The rename box on a row. What the box holds is not what is on disk until the server has accepted
 * it, so the row goes on showing the listing's name throughout: on success the listing brings in the
 * new one, and on failure there is nothing to show.
 */
export function useRowRename(parentDir: string, name: string, path: string): IRowRename {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(name);
  const [renameRequest, setRenameRequest] = useAtom(renameRequestAtom);
  const { rename } = useContentActions();

  const start = useCallback(() => {
    setText(name);
    setIsEditing(true);
  }, [name]);

  // Asked for from outside the row: by a create, since the server named it `untitled` and this is the
  // moment to say what it is, or by F2, which is handled for the tree as a whole.
  useEffect(() => {
    if (renameRequest !== path) {
      return;
    }
    setRenameRequest('');
    start();
  }, [renameRequest, path, setRenameRequest, start]);

  return {
    isEditing,
    text,
    onChange: setText,
    start,
    cancel: () => setIsEditing(false),
    submit: async () => {
      setIsEditing(false);
      await rename(parentDir, name, text);
    },
  };
}

export interface IRowDelete {
  /** True while the confirmation is up. */
  asking: boolean;
  deleting: boolean;
  ask: () => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

/**
 * Deleting the rows an action applies to, which is never done without asking: there is no undo and no
 * trash. `path` is the row the dialog belongs to; `scope` is everything it would take.
 */
export function useRowDelete(path: string, scope: string[]): IRowDelete {
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteRequest, setDeleteRequest] = useAtom(deleteRequestAtom);
  const { remove } = useContentActions();
  const selection = useSelection();

  // The Delete key, which is handled for the tree as a whole; see renameRequestAtom's twin.
  useEffect(() => {
    if (deleteRequest !== path) {
      return;
    }
    setDeleteRequest('');
    setAsking(true);
  }, [deleteRequest, path, setDeleteRequest]);

  return {
    asking,
    deleting,
    ask: () => setAsking(true),
    cancel: () => setAsking(false),
    confirm: async () => {
      setDeleting(true);
      if (await remove(scope)) {
        // Nothing that was selected is still there to act on, and the rows have gone from the
        // listing, taking this component with them.
        selection.clear();
        return;
      }
      setDeleting(false);
      setAsking(false);
    },
  };
}
