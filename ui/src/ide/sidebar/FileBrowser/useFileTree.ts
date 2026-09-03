import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { ApiError, apiErrorMessage, getDirectory, IContentEntry } from '@/api';
import { baseName, isInside, parentDirOf, rewritePath } from '@/paths';
import {
  expandedDirsAtom,
  fileBrowserErrorAtom,
  pendingDirsAtom,
  treeChildrenAtom,
  treeRootAtom,
  visibleChildrenAtom,
  visibleRowsAtom,
} from './atoms';

const NOTHING: IContentEntry[] = [];

export interface ITreeEdits {
  /** Re-reads one directory. */
  read: (path: string) => Promise<void>;
  /** Reads a folder and opens it. */
  expand: (path: string) => Promise<void>;
  /** Takes a path out of the tree once it has gone from disk, with anything under it. */
  drop: (path: string) => void;
  /** Follows a rename through the tree, so a folder that was open stays open. */
  move: (oldPath: string, newPath: string) => void;
}

export interface IFileTree extends ITreeEdits {
  /** What a directory holds; empty until it has been read. */
  childrenOf: (path: string) => IContentEntry[];
  /** What a directory holds that the hidden-files toggle and the filter box both allow. */
  visibleChildrenOf: (path: string) => IContentEntry[];
  /** Every row on screen in the order they appear; see visibleRowsAtom. */
  visibleRows: () => IContentEntry[];
  /** Whether the directory has ever been read, which is not the same as whether it holds anything. */
  hasRead: (path: string) => boolean;
  isLoading: (path: string) => boolean;
  isExpanded: (path: string) => boolean;
  toggle: (path: string) => Promise<void>;
  collapseAll: () => void;
  /** Re-reads the root and every open folder, leaving open what was open. */
  refresh: () => Promise<void>;
}

/**
 * Changes to the tree, for the rows that cause them without reading it. Write-only on purpose: a
 * file row that subscribed to the listings would re-render every time any folder anywhere was opened.
 */
export function useTreeEdits(): ITreeEdits {
  const setChildren = useSetAtom(treeChildrenAtom);
  const setExpanded = useSetAtom(expandedDirsAtom);
  const setPending = useSetAtom(pendingDirsAtom);
  const setError = useSetAtom(fileBrowserErrorAtom);

  const read = useCallback(
    async (path: string) => {
      setPending((current) => (current.includes(path) ? current : [...current, path]));
      try {
        const directory = await getDirectory(path);
        setChildren((current) => ({ ...current, [path]: directory.content ?? NOTHING }));
        setError('');
      } catch (error: unknown) {
        setError(apiErrorMessage(error));
      } finally {
        setPending((current) => current.filter((dir) => dir !== path));
      }
    },
    [setChildren, setError, setPending]
  );

  const expand = useCallback(
    async (path: string) => {
      await read(path);
      setExpanded((current) => (current.includes(path) ? current : [...current, path]));
    },
    [read, setExpanded]
  );

  const drop = useCallback(
    (path: string) => {
      const parentDir = parentDirOf(path);
      setChildren((current) => {
        const next: Record<string, IContentEntry[]> = {};
        Object.entries(current).forEach(([dir, entries]) => {
          if (isInside(dir, path)) {
            return;
          }
          next[dir] = dir === parentDir ? entries.filter((entry) => entry.path !== path) : entries;
        });
        return next;
      });
      setExpanded((current) => current.filter((dir) => !isInside(dir, path)));
    },
    [setChildren, setExpanded]
  );

  const move = useCallback(
    (oldPath: string, newPath: string) => {
      setChildren((current) => {
        const next: Record<string, IContentEntry[]> = {};
        Object.entries(current).forEach(([dir, entries]) => {
          next[rewritePath(dir, oldPath, newPath) ?? dir] = entries.map((entry) => {
            const moved = rewritePath(entry.path, oldPath, newPath);
            return moved === null ? entry : { ...entry, path: moved, name: baseName(moved) };
          });
        });
        return next;
      });
      setExpanded((current) => current.map((dir) => rewritePath(dir, oldPath, newPath) ?? dir));
    },
    [setChildren, setExpanded]
  );

  return { read, expand, drop, move };
}

/**
 * The listings behind the tree, held per directory in one store. Rows read from it rather than
 * fetching for themselves, which is what lets the panel re-read the tree — on a watcher event, or
 * when the refresh button is pressed — without collapsing what the user had opened.
 */
export function useFileTree(): IFileTree {
  const children = useAtomValue(treeChildrenAtom);
  const visibleChildren = useAtomValue(visibleChildrenAtom);
  const visibleRows = useAtomValue(visibleRowsAtom);
  const expanded = useAtomValue(expandedDirsAtom);
  const pending = useAtomValue(pendingDirsAtom);
  const root = useAtomValue(treeRootAtom);
  const setChildren = useSetAtom(treeChildrenAtom);
  const setExpanded = useSetAtom(expandedDirsAtom);
  const setError = useSetAtom(fileBrowserErrorAtom);
  const setRoot = useSetAtom(treeRootAtom);
  const edits = useTreeEdits();

  const refresh = useCallback(async () => {
    const failed: string[] = [];
    let readTheRoot = false;
    const listings = await Promise.all(
      [root, ...expanded.filter((dir) => dir !== root)].map(async (path) => {
        try {
          const entries = (await getDirectory(path)).content ?? NOTHING;
          readTheRoot = readTheRoot || path === root;
          return { path, entries };
        } catch (error: unknown) {
          if (path === root) {
            setError(apiErrorMessage(error));
            // Rooted at a folder that has since gone, from another window or from outside the app
            // altogether. Its parent is a view with a way out of it; this one is not.
            if (root !== '' && error instanceof ApiError && error.status === 404) {
              setRoot(parentDirOf(root));
            }
          } else {
            failed.push(path);
          }
          return null;
        }
      })
    );

    // A folder that no longer reads while the root still does has gone from disk, and is dropped
    // without a word: the listing it was in has just been re-read without it. When the root failed
    // too, nothing has gone anywhere — the server is unreachable, and closing every open folder is
    // the wrong answer to that.
    const gone = readTheRoot ? failed : [];

    setChildren((current) => {
      const next = { ...current };
      Object.keys(next)
        .filter((dir) => gone.some((missing) => isInside(dir, missing)))
        .forEach((dir) => delete next[dir]);
      listings.forEach((listing) => {
        if (listing !== null) {
          next[listing.path] = listing.entries;
        }
      });
      return next;
    });
    if (gone.length > 0) {
      setExpanded((current) => current.filter((dir) => !gone.some((m) => isInside(dir, m))));
    }
    if (readTheRoot) {
      // Whatever went wrong last time has been answered by a tree that reads: leaving the message up
      // after the server came back means it never goes away.
      setError('');
    }
  }, [expanded, root, setChildren, setExpanded, setError, setRoot]);

  return {
    ...edits,
    childrenOf: (path: string) => children[path] ?? NOTHING,
    visibleChildrenOf: (path: string) => visibleChildren[path] ?? NOTHING,
    visibleRows: () => visibleRows,
    hasRead: (path: string) => children[path] !== undefined,
    isLoading: (path: string) => pending.includes(path),
    collapseAll: () => setExpanded([]),
    isExpanded: (path: string) => expanded.includes(path),
    toggle: async (path: string) => {
      if (expanded.includes(path)) {
        // Collapsing keeps the listing: it is still what the folder held, and re-reading a folder in
        // order to hide it is work for nothing.
        setExpanded((current) => current.filter((dir) => dir !== path));
        return;
      }
      await edits.expand(path);
    },
    refresh,
  };
}
