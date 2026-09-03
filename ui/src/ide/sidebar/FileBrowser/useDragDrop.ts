import React, { useState } from 'react';
import { useSetAtom } from 'jotai';

import { isInside, parentDirOf } from '@/paths';
import { uploadRequestAtom } from './atoms';
import { pendingFromDrop } from './uploads';
import { useContentActions } from './useContentActions';
import { useSelection } from './useSelection';

/**
 * The drag payload's own type, so a drag from inside the tree can be told from files dragged in from
 * the desktop: one moves what is already in the project, the other uploads.
 */
const DRAG_TYPE = 'application/x-zasper-paths';

/** Alt on a mac, Ctrl elsewhere; both accepted either way, as they are for a drag anywhere else. */
const isCopying = (event: React.DragEvent) => event.altKey || event.ctrlKey;

/** A drag from outside the browser: files from the desktop, which are an upload rather than a move. */
const isFromDesktop = (event: React.DragEvent) => event.dataTransfer.types.includes('Files');

export interface IDragSource {
  draggable: true;
  onDragStart: (event: React.DragEvent) => void;
}

/** Makes a row draggable. It carries the selection when it is part of one, and itself otherwise. */
export function useDragSource(path: string): IDragSource {
  const selection = useSelection();

  return {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      selection.ensureSelected(path);
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(selection.scopeFor(path)));
      event.dataTransfer.effectAllowed = 'copyMove';
    },
  };
}

export interface IDropTarget {
  /** True while a drop here would do something, for the row to show that it would. */
  isOver: boolean;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

/** Makes a folder — or the empty space, which is the project root — somewhere rows can be dropped. */
export function useDropTarget(dir: string): IDropTarget {
  const [isOver, setIsOver] = useState(false);
  const setUploadRequest = useSetAtom(uploadRequestAtom);
  const { moveTo, copyTo } = useContentActions();
  const selection = useSelection();

  const wouldDoSomething = (event: React.DragEvent) => {
    if (isFromDesktop(event)) {
      return true;
    }
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) {
      return false;
    }
    // dataTransfer will not give up its data before the drop, so the judgement has to be made from
    // the selection — which is what the drag set out with, since dragging ensures it.
    if (selection.paths.some((from) => isInside(dir, from))) {
      return false;
    }
    // A move into the folder something is already in is nothing; a copy into it is a duplicate.
    return isCopying(event) || selection.paths.some((from) => parentDirOf(from) !== dir);
  };

  return {
    isOver,

    onDragOver: (event: React.DragEvent) => {
      if (!wouldDoSomething(event)) {
        return;
      }
      // Both: preventDefault is what makes this a drop target at all, and without stopPropagation a
      // drop on a nested folder would also count as a drop on everything it sits in.
      event.preventDefault();
      event.stopPropagation();
      // Desktop files are always a copy: nothing is taken off the machine they came from.
      event.dataTransfer.dropEffect = isFromDesktop(event) || isCopying(event) ? 'copy' : 'move';
      setIsOver(true);
    },

    // dragleave also fires on the way into a child element, which would flicker the highlight off.
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setIsOver(false);
      }
    },

    onDrop: (event: React.DragEvent) => {
      setIsOver(false);
      if (isFromDesktop(event)) {
        // Both, as above — and preventDefault doubly so here: left alone, the browser would leave the
        // app and open the dropped file itself.
        event.preventDefault();
        event.stopPropagation();
        // Asked now rather than inside the promise: the item list is emptied when this returns, and
        // a folder can only be seen into through it.
        void pendingFromDrop(event.dataTransfer).then((pending) => {
          if (pending.length > 0) {
            setUploadRequest({ parentDir: dir, pending });
          }
        });
        return;
      }
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      let paths: string[] = [];
      try {
        paths = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as string[];
      } catch {
        return;
      }
      selection.clear();
      void (isCopying(event) ? copyTo(paths, dir) : moveTo(paths, dir));
    },
  };
}
