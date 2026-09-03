import React, { useEffect, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';

import { IContentEntry } from '@/api';
import { parentDirOf } from '@/paths';
import { useTabActions } from '@/store/TabActions';
import { deleteRequestAtom, focusedPathAtom, renameRequestAtom, treeRootAtom } from './atoms';
import { useClipboard } from './useClipboard';
import { useFileTree } from './useFileTree';
import { useSelection } from './useSelection';

export interface IRowFocus {
  ref: React.RefObject<HTMLLIElement | null>;
  /** Roving: one row in the tree is reachable by Tab, and the arrow keys move between the rest. */
  tabIndex: number;
  onFocus: (event: React.FocusEvent) => void;
}

/**
 * A row's part in keyboard navigation. Focus lives on the `li`, which is the treeitem: the row's link
 * is inside it, and so is the group holding its children.
 */
export function useRowFocus(path: string, isFirstRow: boolean): IRowFocus {
  const ref = useRef<HTMLLIElement | null>(null);
  const [focusedPath, setFocusedPath] = useAtom(focusedPathAtom);
  const isFocused = focusedPath === path;

  // The arrow keys move the atom; the DOM has to follow, or the next key press goes to the row that
  // was left behind.
  useEffect(() => {
    const row = ref.current;
    if (!isFocused || row === null || row === document.activeElement) {
      return;
    }
    // Never off the rename box, which is inside the row and closes when it loses the focus.
    if (row.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') {
      return;
    }
    row.focus();
  }, [isFocused]);

  return {
    ref,
    // Until something has been focused, the first row is the way in.
    tabIndex: isFocused || (focusedPath === '' && isFirstRow) ? 0 : -1,
    // A treeitem holds the rows below it, and focus bubbles: without this, focusing a row inside an
    // open folder would make the *folder* the focused row, and the next arrow key would act on it.
    onFocus: (event: React.FocusEvent) => {
      if (event.target === event.currentTarget) {
        setFocusedPath(path);
      }
    },
  };
}

/**
 * The tree's keyboard, handled once for the whole panel rather than per row: every key here is about
 * where the focus is or what is selected, and neither is a single row's business.
 */
export function useTreeKeys(): (event: React.KeyboardEvent) => void {
  const [focusedPath, setFocusedPath] = useAtom(focusedPathAtom);
  const root = useAtomValue(treeRootAtom);
  const setRenameRequest = useSetAtom(renameRequestAtom);
  const setDeleteRequest = useSetAtom(deleteRequestAtom);
  const { visibleRows, isExpanded, toggle, expand } = useFileTree();
  const { openTab } = useTabActions();
  const selection = useSelection();
  const clipboard = useClipboard();

  /** Moving the focus takes the selection with it, as a single-select list would. */
  const focus = (entry: IContentEntry | undefined) => {
    if (entry === undefined) {
      return;
    }
    setFocusedPath(entry.path);
    selection.select(entry.path);
  };

  return (event: React.KeyboardEvent) => {
    // The rename box is inside a row, and its keys are its own.
    if ((event.target as HTMLElement).tagName === 'INPUT') {
      return;
    }

    const rows = visibleRows();
    const index = rows.findIndex((entry) => entry.path === focusedPath);
    const here = index === -1 ? undefined : rows[index];
    const clamp = (at: number) => rows[Math.min(Math.max(at, 0), rows.length - 1)];
    const isFolder = here?.type === 'directory';
    const scope = here === undefined ? [] : selection.scopeFor(here.path);
    const modifier = event.metaKey || event.ctrlKey;

    // Every case that does nothing returns instead of breaking, so the key is left to whoever else
    // wants it rather than being swallowed by the preventDefault below.
    switch (event.key) {
      case 'ArrowDown':
        focus(here === undefined ? rows[0] : clamp(index + 1));
        break;
      case 'ArrowUp':
        focus(here === undefined ? rows[0] : clamp(index - 1));
        break;
      case 'Home':
        focus(rows[0]);
        break;
      case 'End':
        focus(rows[rows.length - 1]);
        break;

      // Right opens a folder and then walks into it; left closes it and then walks out to its parent.
      case 'ArrowRight':
        if (here === undefined || !isFolder) {
          return;
        }
        if (isExpanded(here.path)) {
          focus(rows[index + 1]);
        } else {
          void expand(here.path);
        }
        break;
      case 'ArrowLeft':
        if (here === undefined) {
          return;
        }
        if (isFolder && isExpanded(here.path)) {
          void toggle(here.path);
        } else {
          focus(rows.find((entry) => entry.path === parentDirOf(here.path)));
        }
        break;

      case 'Enter':
        if (here === undefined) {
          return;
        }
        if (isFolder) {
          void toggle(here.path);
        } else {
          openTab({ name: here.name, path: here.path, type: here.type });
        }
        break;

      case 'F2':
        if (here === undefined) {
          return;
        }
        setRenameRequest(here.path);
        break;
      case 'Delete':
      case 'Backspace':
        if (here === undefined) {
          return;
        }
        setDeleteRequest(here.path);
        break;

      case 'Escape':
        selection.clear();
        break;

      case 'a':
        if (!modifier) {
          return;
        }
        selection.selectAll(rows.map((entry) => entry.path));
        break;
      case 'c':
        if (!modifier || scope.length === 0) {
          return;
        }
        clipboard.copy(scope);
        break;
      case 'x':
        if (!modifier || scope.length === 0) {
          return;
        }
        clipboard.cut(scope);
        break;
      case 'v': {
        if (!modifier || clipboard.held === null) {
          return;
        }
        // Into the folder that is focused, or into the one holding whatever is.
        const into = here === undefined ? root : isFolder ? here.path : parentDirOf(here.path);
        void clipboard.paste(into);
        break;
      }

      default:
        return;
    }

    event.preventDefault();
    // The command dispatcher listens on the window and would otherwise see these on their way up.
    event.stopPropagation();
  };
}
