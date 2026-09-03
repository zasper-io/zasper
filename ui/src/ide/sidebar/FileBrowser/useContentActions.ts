import { useSetAtom } from 'jotai';

import {
  apiErrorMessage,
  ContentType,
  copyContent,
  createContent,
  deleteContent,
  downloadContent,
  moveContent,
  renameContent,
} from '@/api';
import { copyToClipboard, saveAs } from '@/browser';
import { baseName, isInside, joinPath, parentDirOf } from '@/paths';
import { useTabActions } from '@/store/TabActions';
import { fileBrowserErrorAtom, renameRequestAtom } from './atoms';
import { useTreeEdits } from './useFileTree';

/** The one wording for what neither a move nor a copy can do, whichever end of it noticed. */
const INTO_ITSELF = 'A folder cannot be moved or copied inside itself.';

export interface IContentActions {
  /** Creates an untitled file, folder or notebook and offers to rename it. */
  create: (parentDir: string, contentType: ContentType) => Promise<boolean>;
  /** Renames on disk, taking any open tab with it. False when nothing happened. */
  rename: (parentDir: string, oldName: string, newName: string) => Promise<boolean>;
  /** Moves paths into another folder under their own names, taking any open tabs with them. */
  moveTo: (paths: string[], toDir: string) => Promise<boolean>;
  /** Copies paths into a folder, under whatever free names the server picks. */
  copyTo: (paths: string[], toDir: string) => Promise<boolean>;
  /** Deletes on disk, closing any tabs of what went. False when nothing happened. */
  remove: (paths: string[]) => Promise<boolean>;
  /** Saves copies to the reader's own machine. */
  download: (paths: string[]) => Promise<boolean>;
  /** Puts the project-relative paths on the system clipboard, one per line. */
  copyPath: (paths: string[]) => Promise<boolean>;
}

/**
 * The actions that change what is on disk. All take a list of paths, since the tree lets more than one
 * row be selected. All are reported rather than logged, and all keep the tree and the open tabs in
 * step: a tab left pointing at a path that no longer exists writes the old file back on its next save.
 */
export function useContentActions(): IContentActions {
  const setError = useSetAtom(fileBrowserErrorAtom);
  const setRenameRequest = useSetAtom(renameRequestAtom);
  const { renameTab, closeDeleted } = useTabActions();
  const { read, expand, move: moveInTree, drop } = useTreeEdits();

  /**
   * One path at a time rather than all at once: the server picks the free name for a copy, so two
   * copies of the same name in flight together could both be told they are `-Copy1`. Answers with the
   * first thing that went wrong, or '' when nothing did, and carries on with the rest either way,
   * since stopping halfway through leaves the user guessing which rows moved.
   */
  const eachPath = async (paths: string[], act: (path: string) => Promise<void>) => {
    const failures: string[] = [];
    for (const path of paths) {
      try {
        await act(path);
      } catch (error: unknown) {
        failures.push(apiErrorMessage(error));
      }
    }
    return failures[0] ?? '';
  };

  /**
   * Always last, after any re-reading: a listing that reads clears the error strip — which is right
   * when the message was about a tree that would not read, and would otherwise wipe the message about
   * what has just failed.
   */
  const report = (failure: string) => {
    setError(failure);
    return failure === '';
  };

  const reread = async (dirs: string[]) =>
    Promise.all(dirs.filter((dir, index, all) => all.indexOf(dir) === index).map(read));

  return {
    create: async (parentDir: string, contentType: ContentType) => {
      let created;
      try {
        created = await createContent(parentDir, contentType);
      } catch (error: unknown) {
        setError(apiErrorMessage(error));
        return false;
      }

      // Opens the folder it went into, so that the new row can be seen; the root is always open.
      await (parentDir === '' ? read('') : expand(parentDir));
      setRenameRequest(created.path);
      return true;
    },

    rename: async (parentDir: string, oldName: string, newName: string) => {
      if (newName.trim() === '') {
        setError('A name is required.');
        return false;
      }
      if (newName === oldName) {
        return false;
      }

      const oldPath = joinPath(parentDir, oldName);
      const newPath = joinPath(parentDir, newName);
      try {
        await renameContent(parentDir, oldName, newName);
      } catch (error: unknown) {
        setError(apiErrorMessage(error));
        return false;
      }

      setError('');
      moveInTree(oldPath, newPath);
      renameTab(oldPath, newPath);
      return true;
    },

    moveTo: async (paths: string[], toDir: string) => {
      // Rows already in the destination are not an error; they are simply not going anywhere, which
      // is what a drag onto the folder a row is already in amounts to.
      const moving = paths.filter((from) => parentDirOf(from) !== toDir);
      if (moving.length === 0) {
        return false;
      }
      // Asked here as well as on the server, so a drag onto a folder's own row is simply refused
      // rather than sent off to be refused.
      if (moving.some((from) => isInside(toDir, from))) {
        setError(INTO_ITSELF);
        return false;
      }

      const failure = await eachPath(moving, async (from) => {
        const to = joinPath(toDir, baseName(from));
        await moveContent(from, to);
        // The subtree first, so a folder that was open stays open.
        moveInTree(from, to);
        renameTab(from, to);
      });
      // Both ends, since one listing has lost rows and the other has gained them.
      await reread([...moving.map(parentDirOf), toDir]);
      return report(failure);
    },

    copyTo: async (paths: string[], toDir: string) => {
      if (paths.some((from) => isInside(toDir, from))) {
        setError(INTO_ITSELF);
        return false;
      }

      const failure = await eachPath(paths, async (from) => {
        await copyContent(from, toDir);
      });
      // No rename offer here, unlike a create: the name the copy took says what it is.
      await (toDir === '' ? read('') : expand(toDir));
      return report(failure);
    },

    remove: async (paths: string[]) =>
      report(
        await eachPath(paths, async (path) => {
          await deleteContent(path);
          drop(path);
          closeDeleted(path);
        })
      ),

    download: async (paths: string[]) =>
      report(
        await eachPath(paths, async (path) => {
          saveAs(await downloadContent(path), baseName(path));
        })
      ),

    copyPath: async (paths: string[]) => {
      if (!(await copyToClipboard(paths.join('\n')))) {
        // The Clipboard API is only there over HTTPS or on localhost, and a copy that quietly did
        // nothing is worse than one that says so.
        setError('The browser would not allow writing to the clipboard.');
        return false;
      }
      setError('');
      return true;
    },
  };
}
