// State private to the file browser. Only this folder reads it; src/store/ is for state features share.

import { atom } from 'jotai';

import { ContentType, ContentEntry } from '@/api';
import { PendingUpload } from './uploads';

export interface UploadDialogRequest {
  /** The folder the files are going into; '' is the project root. */
  parentDir: string;
  /** Files a drop already chose, which start at once. Empty when the dialog was opened from a menu. */
  pending: PendingUpload[];
}

/** The upload the dialog is showing, or null: a drop settles the destination and the files together. */
export const uploadRequestAtom = atom<UploadDialogRequest | null>(null);

/** Why the last action failed: the row is anywhere in the tree, the message belongs at the top. */
export const fileBrowserErrorAtom = atom<string>('');

/**
 * Every directory read, keyed by path; '' is the project root. One store rather than a listing per
 * row, so re-reading the tree puts back what was open instead of collapsing it.
 */
export const treeChildrenAtom = atom<Record<string, ContentEntry[]>>({});

/** The folders that are open, by path. */
export const expandedDirsAtom = atom<string[]>([]);

/**
 * The folder the tree is rooted at; '' is the project root. A view, not a change: the server's root is
 * fixed. Listings outside it are kept, so going back up is not a reload.
 */
export const treeRootAtom = atom<string>('');

/** The directories being read: what tells "not read yet" from "read and empty". */
export const pendingDirsAtom = atom<string[]>([]);

/** Dotfiles are out of the way by default; `.git` and `.venv` are not what the panel is for. */
export const showHiddenFilesAtom = atom<boolean>(false);

/** What the filter box holds. A folder survives when its name or anything read below it matches. */
export const treeFilterAtom = atom<string>('');

const NOTHING: ContentEntry[] = [];

/**
 * What the hidden-files toggle and the filter both allow, by path. Derived once for the tree rather
 * than per row, which would re-walk the subtree each time. Nothing unread is fetched to search it.
 */
export const visibleChildrenAtom = atom<Record<string, ContentEntry[]>>((get) => {
  const children = get(treeChildrenAtom);
  const showHidden = get(showHiddenFilesAtom);
  const filter = get(treeFilterAtom).trim().toLowerCase();

  const subtreeMatches = (path: string): boolean =>
    (children[path] ?? NOTHING).some(
      (entry) =>
        entry.name.toLowerCase().includes(filter) ||
        (entry.type === 'directory' && subtreeMatches(entry.path))
    );

  const visible: Record<string, ContentEntry[]> = {};
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

/** Every row on screen, top down: what a shift-click range and the arrow keys are measured in. */
export const visibleRowsAtom = atom<ContentEntry[]>((get) => {
  const visible = get(visibleChildrenAtom);
  const expanded = get(expandedDirsAtom);
  const rows: ContentEntry[] = [];

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

/** What Copy or Cut set aside. A cut is carried out on paste, so one never pasted costs nothing. */
export const clipboardAtom = atom<{ paths: string[]; cut: boolean } | null>(null);

/** The rows the next action applies to: one after a plain click, more after cmd- or shift-click. */
export const selectedPathsAtom = atom<string[]>([]);

/** The row a shift-click measures its range from: the last one clicked without shift. */
export const selectionAnchorAtom = atom<string>('');

/**
 * Selects everything between the anchor and `path`, in screen order. Write-only rather than a hook:
 * a row subscribing to the listings to learn that order would re-render whenever any folder was read.
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

export interface RenameRequest {
  /** The row whose rename box should open. */
  path: string;
  /** The name on disk is the server's invention, so the box opens empty rather than at `untitled.txt`. */
  naming?: boolean;
  /** What was just created, which is what says whether the name needs an extension keeping. */
  contentType?: ContentType;
}

/** A row that should open its rename box. Set by a create (no row yet) and by F2 (the tree's keys). */
export const renameRequestAtom = atom<RenameRequest | null>(null);

/** A path whose row should ask whether to delete, for the same reason: F2's neighbour on the keyboard. */
export const deleteRequestAtom = atom<string>('');

/** The row the keyboard is on, which is not the selection: it is the one row Tab reaches. */
export const focusedPathAtom = atom<string>('');
