import { useCallback, useEffect, useState } from 'react';
import { useAtom } from 'jotai';

import { deleteRequestAtom, renameRequestAtom } from './atoms';
import { useContentActions } from './useContentActions';
import { useSelection } from './useSelection';

/** What a notebook is called, whatever else it is called. */
const NOTEBOOK_EXTENSION = '.ipynb';

/**
 * The name a submitted box asks for.
 *
 * Only a notebook has anything added: nothing that opens a notebook — this editor included — recognises
 * one by anything but its extension, so a name typed without it would make a file that cannot be opened
 * as what it was created as. A file and a folder are named exactly as typed, `Makefile` included, and an
 * extension typed here already is not doubled.
 */
function nameToSubmit(typed: string, extension: string): string {
  if (extension === '' || typed.trim() === '' || typed.toLowerCase().endsWith(extension)) {
    return typed;
  }
  return typed + extension;
}

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
  // What the submitted name must end in, which is only ever anything while a new notebook is being
  // named: an edit of a name that exists is taken as typed, extension and all.
  const [extension, setExtension] = useState('');
  const [renameRequest, setRenameRequest] = useAtom(renameRequestAtom);
  const { rename } = useContentActions();

  const open = useCallback((initial: string, ending = '') => {
    setText(initial);
    setExtension(ending);
    setIsEditing(true);
  }, []);

  const start = useCallback(() => open(name), [open, name]);

  // Asked for from outside the row: by a create, since the server named it `untitled` and this is the
  // moment to say what it is, or by F2, which is handled for the tree as a whole. A create opens the
  // box empty — there is nothing there worth keeping — where F2 offers the current name to edit.
  useEffect(() => {
    if (renameRequest?.path !== path) {
      return;
    }
    const { naming, contentType } = renameRequest;
    setRenameRequest(null);
    if (naming) {
      open('', contentType === 'notebook' ? NOTEBOOK_EXTENSION : '');
    } else {
      open(name);
    }
  }, [renameRequest, path, name, setRenameRequest, open]);

  return {
    isEditing,
    text,
    onChange: setText,
    start,
    cancel: () => setIsEditing(false),
    submit: async () => {
      setIsEditing(false);
      await rename(parentDir, name, nameToSubmit(text, extension));
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
