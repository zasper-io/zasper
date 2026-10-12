import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { selectAtom } from 'jotai/utils';

import { getNotebook, NotebookModel } from '@/api';
import { useFileWatcher } from '@/ide/useContentWatcher';
import { diskComparesAtom, diskResolutionsAtom, without } from '@/store/diskChanges';
import { FileTab } from '@/store/tabState';
import { changeBetween } from '@/ide/editor/textChange';

import { DiskConflicts, HeldChanges, mergeFromDisk } from './diskMerge';
import { stringifyNotebook } from './useNotebookDocument';
import { NotebookCells } from './useNotebookCells';

/** What a version on disk did to the open notebook. */
type Reconciled =
  /** Nothing changed, or every change came in without asking; `notebook` is what is open now. */
  | { asked: false; notebook: NotebookModel }
  /** Something is left for the reader to choose. */
  | { asked: true };

/*
The rule for a notebook, which is not the file editor's: reconciling with disk considers a cell's source
only, cell by cell. Outputs belong to the kernel session and never make a change on disk ask anything. A
cell the reader has not touched takes the file's version silently; only a cell both sides changed asks,
and it asks on the cell. A notebook before nbformat 4.5 has no cell ids to match by, and falls back to the
file editor's band over the whole document.

`typingIn` answers the cell whose editor has the keyboard: a change on disk to that one cell is held until
the reader leaves it, rather than moving the text under the cursor. `viewFor` is a cell's editor.
*/
export function useNotebookDisk(
  tab: FileTab,
  cells: NotebookCells,
  typingIn: () => string | null,
  viewFor: (cellId: string) => EditorView | null
) {
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  /** The file's text, when a notebook without cell ids changed on disk under unsaved edits. */
  const [wholeConflict, setWholeConflict] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<DiskConflicts>({});
  const conflictsRef = useRef(conflicts);
  conflictsRef.current = conflicts;
  const [held, setHeld] = useState<HeldChanges>({});
  const heldRef = useRef(held);
  heldRef.current = held;
  /** Whether what is asked was raised by a refused save rather than by the watcher. */
  const [refused, setRefused] = useState(false);
  /** Who made the change being asked about, when the watch said. */
  const [changedBy, setChangedBy] = useState<string | undefined>();
  const lastWriter = useRef<string | undefined>(undefined);

  const setCompares = useSetAtom(diskComparesAtom);
  const [resolution] = useAtom(
    useMemo(() => selectAtom(diskResolutionsAtom, (all) => all[tab.path]), [tab.path])
  );
  const setResolutions = useSetAtom(diskResolutionsAtom);
  useEffect(
    () => () => {
      setCompares((compares) => without(compares, tab.path));
      setResolutions((resolutions) => without(resolutions, tab.path));
    },
    [tab.path, setCompares, setResolutions]
  );

  /**
   * Opens the notebook on `next`, and counts it saved when it is exactly what the file holds.
   *
   * A changed cell's editor is given its new source first, as the file editor takes a change on disk: an
   * edit between the common start and end of the two versions, so the cursor stays where it was, and kept
   * out of undo, so undo steps back through the reader's own edits. A version the reader chose is an edit
   * like any other, and undo takes it back. The editor then already holds what `value` brings it.
   */
  const show = useCallback(
    (next: NotebookModel, chosen = false) => {
      const current = cellsRef.current;
      for (const cell of next.cells) {
        const view = viewFor(cell.id);
        const doc = view?.state.doc.toString();
        if (view && doc !== undefined && doc !== cell.source) {
          view.dispatch({
            changes: changeBetween(doc, cell.source),
            ...(chosen ? {} : { annotations: Transaction.addToHistory.of(false) }),
          });
        }
      }
      current.setNotebook(next);
      if (stringifyNotebook(next) === current.diskForm.current) {
        current.markSaved(next);
      }
    },
    [viewFor]
  );

  const setAllConflicts = useCallback((next: DiskConflicts) => {
    conflictsRef.current = next;
    setConflicts(next);
  }, []);

  const setAllHeld = useCallback((next: HeldChanges) => {
    heldRef.current = next;
    setHeld(next);
  }, []);

  /** Brings a version of the file into the open notebook. */
  const reconcile = useCallback(
    (content: NotebookModel, hash: string): Reconciled => {
      const current = cellsRef.current;
      const onDisk = stringifyNotebook(content);
      current.diskHash.current = hash;
      if (onDisk === current.diskForm.current) {
        return { asked: false, notebook: current.notebook };
      }
      const base = current.diskForm.current === null ? null : JSON.parse(current.diskForm.current);
      const merged =
        base === null
          ? null
          : mergeFromDisk(base, current.notebook, content, typingIn(), heldRef.current);

      if (merged === null) {
        if (!current.sourceUnsaved) {
          setWholeConflict(null);
          current.applyNotebook(content);
          return { asked: false, notebook: content };
        }
        // Known either way, so a reader who keeps their own version is not asked about it again.
        current.diskForm.current = onDisk;
        if (stringifyNotebook(current.notebook) === onDisk) {
          setWholeConflict(null);
          current.markSaved(current.notebook);
          return { asked: false, notebook: current.notebook };
        }
        setWholeConflict(onDisk);
        return { asked: true };
      }

      current.diskForm.current = onDisk;
      // A conflict stays until it is answered, even once the file's version has become the base.
      const kept: DiskConflicts = {};
      for (const id of Object.keys(conflictsRef.current)) {
        const mine = merged.notebook.cells.find((cell) => cell.id === id);
        const theirs = content.cells.find((cell) => cell.id === id) ?? null;
        if (mine !== undefined && (theirs === null || theirs.source !== mine.source)) {
          kept[id] = theirs;
        }
      }
      const next = { ...kept, ...merged.conflicts };
      setAllConflicts(next);
      setAllHeld(merged.held);
      show(merged.notebook);
      return Object.keys(next).length > 0
        ? { asked: true }
        : { asked: false, notebook: merged.notebook };
    },
    [show, setAllConflicts, setAllHeld, typingIn]
  );

  const takeChangeFromDisk = useCallback(async () => {
    let read;
    try {
      read = await getNotebook(tab.path);
    } catch {
      return;
    }
    setRefused(false);
    if (reconcile(read.content, read.hash ?? '').asked) {
      setChangedBy(lastWriter.current);
    }
  }, [tab.path, reconcile]);

  /**
   * Releases held cells into the document: those the cursor has left, or all of them before a save.
   * Answers the notebook as it now is.
   */
  const release = useCallback(
    (focusedCellId: string | null): NotebookModel => {
      const current = cellsRef.current;
      if (Object.keys(heldRef.current).length === 0 || current.diskForm.current === null) {
        return current.notebook;
      }
      const disk: NotebookModel = JSON.parse(current.diskForm.current);
      const merged = mergeFromDisk(disk, current.notebook, disk, focusedCellId, heldRef.current);
      if (merged === null) {
        return current.notebook;
      }
      setAllHeld(merged.held);
      if (Object.keys(merged.conflicts).length > 0) {
        setAllConflicts({ ...conflictsRef.current, ...merged.conflicts });
      }
      show(merged.notebook);
      return merged.notebook;
    },
    [show, setAllConflicts, setAllHeld]
  );

  // Moving to another cell is what releases one held: a blur alone renders nothing to notice it by.
  useEffect(() => {
    const typing = typingIn();
    if (Object.keys(held).some((id) => id !== typing)) {
      release(typing);
    }
  }, [cells.focusedCellId, held, release, typingIn]);

  const changedWhileHidden = useRef(false);
  useFileWatcher(tab.path, (hash, by) => {
    lastWriter.current = by;
    // The version this editor already holds, such as the echo of its own save.
    if (hash !== undefined && hash === cellsRef.current.diskHash.current) {
      return;
    }
    if (!tab.active) {
      changedWhileHidden.current = true;
      return;
    }
    void takeChangeFromDisk();
  });
  useEffect(() => {
    if (tab.active && changedWhileHidden.current) {
      changedWhileHidden.current = false;
      void takeChangeFromDisk();
    }
  }, [tab.active, takeChangeFromDisk]);

  /**
   * A save the server refused because the file changed after it was read. The file's version is
   * brought in as any change on disk is; resolves to the notebook to save again when nothing was left
   * to ask, or to null when the reader has to choose first.
   */
  const refuseSave = useCallback(
    async (written: NotebookModel): Promise<NotebookModel | null> => {
      let read;
      try {
        read = await getNotebook(tab.path);
      } catch {
        cellsRef.current.diskHash.current = '';
        return written;
      }
      if (stringifyNotebook(read.content) === stringifyNotebook(written)) {
        cellsRef.current.diskHash.current = read.hash ?? '';
        return written;
      }
      const reconciled = reconcile(read.content, read.hash ?? '');
      if (reconciled.asked) {
        setRefused(true);
        return null;
      }
      return reconciled.notebook;
    },
    [tab.path, reconcile]
  );

  /** After a save: nothing is left to ask about the version that was written over. */
  const saved = useCallback(() => {
    setWholeConflict(null);
    setAllConflicts({});
    setRefused(false);
  }, [setAllConflicts]);

  const keepMine = useCallback(
    (cellId: string) => {
      const { [cellId]: _answered, ...rest } = conflictsRef.current;
      setAllConflicts(rest);
    },
    [setAllConflicts]
  );

  const takeTheirs = useCallback(
    (cellId: string) => {
      const theirs = conflictsRef.current[cellId];
      if (theirs === undefined) {
        return;
      }
      const notebook = cellsRef.current.notebook;
      const { [cellId]: _answered, ...rest } = conflictsRef.current;
      setAllConflicts(rest);
      show(
        {
          ...notebook,
          cells:
            theirs === null
              ? notebook.cells.filter((cell) => cell.id !== cellId)
              : notebook.cells.map((cell) =>
                  cell.id === cellId
                    ? {
                        ...theirs,
                        reload: false,
                        outputs: cell.outputs,
                        execution_count: cell.execution_count,
                      }
                    : cell
                ),
        },
        true
      );
    },
    [setAllConflicts, show]
  );

  const keepAllMine = useCallback(() => {
    setWholeConflict(null);
    setAllConflicts({});
  }, [setAllConflicts]);

  const takeAllTheirs = useCallback(async () => {
    if (wholeConflict !== null) {
      setWholeConflict(null);
      await cellsRef.current.loadNotebook(tab.path);
      return;
    }
    Object.keys(conflictsRef.current).forEach(takeTheirs);
  }, [wholeConflict, tab.path, takeTheirs]);

  /** Records the two versions for the comparison tab, which is opened straight after. */
  const compare = useCallback(() => {
    const onDisk = wholeConflict ?? cellsRef.current.diskForm.current;
    if (onDisk !== null) {
      const mine = stringifyNotebook(cellsRef.current.notebook);
      setCompares((compares) => ({ ...compares, [tab.path]: { onDisk, mine } }));
    }
  }, [wholeConflict, tab.path, setCompares]);

  const asking = wholeConflict !== null || Object.keys(conflicts).length > 0;
  useEffect(() => {
    if (!asking) {
      setCompares((compares) => without(compares, tab.path));
    }
  }, [asking, tab.path, setCompares]);

  return {
    wholeConflict,
    conflicts,
    held,
    refused,
    changedBy,
    asking,
    resolution,
    clearResolution: () => setResolutions((resolutions) => without(resolutions, tab.path)),
    reconcile,
    release,
    refuseSave,
    saved,
    keepMine,
    takeTheirs,
    keepAllMine,
    takeAllTheirs,
    compare,
  };
}
