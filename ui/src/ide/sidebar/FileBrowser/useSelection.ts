import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { extendSelectionAtom, selectedPathsAtom, selectionAnchorAtom } from './atoms';

export interface ISelection {
  paths: string[];
  isSelected: (path: string) => boolean;
  /**
   * What an action on `path` applies to: the whole selection when that row is part of it, and the row
   * alone otherwise. Right-clicking a row outside the selection acts on that row, as every file
   * manager does, rather than on rows the pointer is nowhere near.
   */
  scopeFor: (path: string) => string[];
  /**
   * A click on a row. True when the click was a selection gesture and nothing else — the caller
   * should not also open the file or toggle the folder.
   */
  handleClick: (path: string, event: React.MouseEvent) => boolean;
  /**
   * Makes `path` part of the selection if it is not already, leaving a longer selection alone. What a
   * right-click and the start of a drag both need: acting on the row that was aimed at, without
   * throwing away a selection that row belongs to.
   */
  ensureSelected: (path: string) => void;
  /** Makes this the only selected row, and the one a later shift-click measures from. */
  select: (path: string) => void;
  selectAll: (paths: string[]) => void;
  clear: () => void;
}

/**
 * Which rows are selected, for the actions that can apply to more than one. Held for the panel rather
 * than per row, since a range spans folders.
 */
export function useSelection(): ISelection {
  const paths = useAtomValue(selectedPathsAtom);
  const setPaths = useSetAtom(selectedPathsAtom);
  const setAnchor = useSetAtom(selectionAnchorAtom);
  const extendTo = useSetAtom(extendSelectionAtom);

  const only = (path: string) => {
    setPaths([path]);
    setAnchor(path);
  };

  const toggle = (path: string) => {
    setPaths((current) =>
      current.includes(path) ? current.filter((each) => each !== path) : [...current, path]
    );
    setAnchor(path);
  };

  return {
    paths,
    isSelected: (path: string) => paths.includes(path),
    scopeFor: (path: string) => (paths.includes(path) && paths.length > 1 ? paths : [path]),

    handleClick: (path: string, event: React.MouseEvent) => {
      if (event.shiftKey) {
        extendTo(path);
        return true;
      }
      // metaKey on a mac, ctrlKey everywhere else; both are accepted either way, since neither
      // means anything else on a row.
      if (event.metaKey || event.ctrlKey) {
        toggle(path);
        return true;
      }
      only(path);
      return false;
    },

    ensureSelected: (path: string) => {
      if (!paths.includes(path)) {
        only(path);
      }
    },

    select: only,
    selectAll: setPaths,

    clear: () => {
      setPaths([]);
      setAnchor('');
    },
  };
}
