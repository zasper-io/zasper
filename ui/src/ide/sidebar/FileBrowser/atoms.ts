// State private to the file browser. These atoms are read and written only by the components in
// this folder, so they stay here rather than in src/store/, which is for state shared across
// features.

import { atom } from 'jotai';

import { IContentEntry } from '@/api';
import { IPendingUpload } from './uploads';

export interface IUploadRequest {
  /** The folder the files are going into; '' is the project root. */
  parentDir: string;
  /** Files a drop already chose, which start going as soon as the dialog is up. Empty when the dialog
   *  was opened from a menu and has yet to ask for anything. */
  pending: IPendingUpload[];
}

/**
 * The upload the dialog is showing, or null when it is closed. One atom rather than a flag and a path,
 * because a drop from the desktop settles the destination and the files together.
 */
export const uploadRequestAtom = atom<IUploadRequest | null>(null);

/**
 * Why the last action failed, shown in the panel until something succeeds. An atom because the rows
 * that fail are anywhere in a recursive tree and the message belongs at the top of the panel.
 */
export const fileBrowserErrorAtom = atom<string>('');

/**
 * Every directory that has been read, keyed by its path; the project root is ''. One store rather
 * than a listing per row, so re-reading the tree can put back what was open instead of collapsing
 * everything below the root.
 */
export const treeChildrenAtom = atom<Record<string, IContentEntry[]>>({});

/** The folders that are open, by path. */
export const expandedDirsAtom = atom<string[]>([]);

/**
 * The folder the tree is rooted at; '' is the project root. A view of the project, not a change to it:
 * the server's root is its working directory, fixed when it started, and re-rooting here only narrows
 * what the panel shows. Nothing outside this folder is rendered, but the listings and open folders
 * outside it are kept, so going back up is not a reload.
 */
export const treeRootAtom = atom<string>('');

/**
 * The directories being read right now, by path. What tells "not read yet" from "read and empty",
 * which the tree used to render identically: as nothing at all.
 */
export const pendingDirsAtom = atom<string[]>([]);

/** Dotfiles are out of the way by default; `.git` and `.venv` are not what the panel is for. */
export const showHiddenFilesAtom = atom<boolean>(false);

/**
 * What the filter box holds. A folder survives it when its own name matches or anything already read
 * below it does, so the path to a match stays on screen.
 */
export const treeFilterAtom = atom<string>('');

const NOTHING: IContentEntry[] = [];

/**
 * Every read directory's children that the hidden-files toggle and the filter box both allow, keyed by
 * path. Derived once for the tree rather than per row: a folder survives the filter when its own name
 * matches or anything already read below it does, which each row would otherwise re-walk for itself.
 *
 * Nothing unread is fetched to search it. A keystroke in the filter box reads what is on screen.
 */
export const visibleChildrenAtom = atom<Record<string, IContentEntry[]>>((get) => {
  const children = get(treeChildrenAtom);
  const showHidden = get(showHiddenFilesAtom);
  const filter = get(treeFilterAtom).trim().toLowerCase();

  const subtreeMatches = (path: string): boolean =>
    (children[path] ?? NOTHING).some(
      (entry) =>
        entry.name.toLowerCase().includes(filter) ||
        (entry.type === 'directory' && subtreeMatches(entry.path))
    );

  const visible: Record<string, IContentEntry[]> = {};
  Object.entries(children).forEach(([dir, entries]) => {
    visible[dir] = entries.filter((entry) => {
      if (!showHidden && entry.name.startsWith('.')) {
        return false;
      }
      return (
        filter === '' ||
        entry.name.toLowerCase().includes(filter) ||
        (entry.type === 'directory' && subtreeMatches(entry.path))
      );
    });
  });
  return visible;
});

/**
 * Every row on screen, from the top down: the visible children of whatever the tree is rooted at, with
 * the children of each open folder in place under it. What a shift-click range and the arrow keys are
 * both measured in.
 */
export const visibleRowsAtom = atom<IContentEntry[]>((get) => {
  const visible = get(visibleChildrenAtom);
  const expanded = get(expandedDirsAtom);
  const rows: IContentEntry[] = [];

  const walk = (path: string) => {
    (visible[path] ?? NOTHING).forEach((entry) => {
      rows.push(entry);
      if (entry.type === 'directory' && expanded.includes(entry.path)) {
        walk(entry.path);
      }
    });
  };
  walk(get(treeRootAtom));
  return rows;
});

/**
 * What Copy or Cut set aside, and which of the two it was. Paste is only offered while this is set,
 * and a cut is only carried out on paste — nothing moves when the cut itself happens, so a cut that
 * is never pasted has cost nothing.
 */
export const clipboardAtom = atom<{ paths: string[]; cut: boolean } | null>(null);

/**
 * The rows the next action applies to. A plain click leaves exactly one in here; cmd-click and
 * shift-click are what build a longer one.
 */
export const selectedPathsAtom = atom<string[]>([]);

/** The row a shift-click measures its range from: the last one clicked without shift. */
export const selectionAnchorAtom = atom<string>('');

/**
 * Selects everything between the anchor and the given path, in the order the rows appear on screen.
 * Write-only, and deliberately not a hook: the row order is only wanted when a shift-click happens, and
 * every row uses the selection — one that subscribed to the listings in order to know the row order
 * would re-render whenever any folder anywhere was read.
 */
export const extendSelectionAtom = atom(null, (get, set, path: string) => {
  const rows = get(visibleRowsAtom).map((row) => row.path);
  const from = rows.indexOf(get(selectionAnchorAtom));
  const to = rows.indexOf(path);
  if (from === -1 || to === -1) {
    set(selectedPathsAtom, [path]);
    set(selectionAnchorAtom, path);
    return;
  }
  set(selectedPathsAtom, rows.slice(Math.min(from, to), Math.max(from, to) + 1));
});

/**
 * A path whose row should open its rename box. Set by a create — the server picks the name, so
 * `untitled.txt` is never what was wanted — and by F2, neither of which happens in the row itself: the
 * row does not exist yet in the first case, and the keyboard is handled for the tree as a whole in the
 * second.
 */
export const renameRequestAtom = atom<string>('');

/** A path whose row should ask whether to delete, for the same reason: F2's neighbour on the keyboard. */
export const deleteRequestAtom = atom<string>('');

/**
 * The row the keyboard is on, which is not the selection: arrow keys move it, and it is the one row in
 * the tree that is reachable by Tab.
 */
export const focusedPathAtom = atom<string>('');
