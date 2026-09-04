import { useAtomValue, useSetAtom } from 'jotai';

import { deleteKernel, DiffTarget, logApiError } from '@/api';
import getFileExtension from '@/ide/utils';
import { baseName, isInside, rewritePath } from '@/paths';
import { kernelsAtom, notebookKernelMapAtom, terminalsAtom, terminalsCountAtom } from './AppState';
import { fileTabsAtom, IfileTab, IfileTabDict } from './TabState';

/** What a caller has to say to open a tab; the rest of IfileTab follows from it. */
export interface IOpenTab {
  name: string;
  path: string;
  type: string;
  kernelspec?: string;
  cwd?: string;
  diff?: DiffTarget;
  /** Which language this holds, when the tab's name is not the file name it can be read from. */
  extension?: string | null;
}

/**
 * The key a diff tab is stored under, which is not the path of the file it is about.
 *
 * Tabs are keyed by path, so a diff keyed by the file's path would collide with the editor for that
 * file — clicking a change in the panel would bring the editor forward and nothing else. Naming the
 * comparison as well as the file also means the staged and unstaged diffs of one file are two tabs,
 * which they have to be: they are different pairs of documents.
 *
 * The cost of a synthetic key is that a diff tab is not rewritten when the file is renamed or closed
 * when it is deleted, since both walk the tabs by path. A stale diff is a tab showing a comparison
 * that was true when it was opened, which is what any diff already is.
 */
export function diffTabKey(target: DiffTarget): string {
  const against =
    target.ref !== undefined ? target.ref : target.staged === true ? 'staged' : 'worktree';
  return `diff:${against}:${target.path}`;
}

export interface ITabActions {
  /** Opens a tab, or brings it to the front when that path is already open. */
  openTab: (tab: IOpenTab) => void;
  /** Opens the two sides of one file's comparison, or brings that comparison to the front. */
  openDiff: (target: DiffTarget) => void;
  /** Opens a new terminal, in `cwd` if one is given. */
  openTerminal: (cwd?: string) => void;
  /** Closes a tab and releases whatever it was holding. */
  closeTab: (path: string) => void;
  /** After a delete on disk: closes the tab, and every tab inside it if it was a folder. */
  closeDeleted: (path: string) => void;
  /** After a rename on disk: moves the affected tabs, so a save goes to the file that now exists. */
  renameTab: (oldPath: string, newPath: string) => void;
}

/**
 * What the tab bar and the file browser both do to open tabs. Shared because the file browser has to
 * do it too: a tab left pointing at a path that no longer exists recreates the old file on its next
 * save.
 */
export function useTabActions(): ITabActions {
  const fileTabs = useAtomValue(fileTabsAtom);
  const setFileTabs = useSetAtom(fileTabsAtom);
  const notebookKernelMap = useAtomValue(notebookKernelMapAtom);
  const setNotebookKernelMap = useSetAtom(notebookKernelMapAtom);
  const setKernels = useSetAtom(kernelsAtom);
  const setTerminals = useSetAtom(terminalsAtom);
  const terminalCount = useAtomValue(terminalsCountAtom);
  const setTerminalCount = useSetAtom(terminalsCountAtom);

  const openTab = (tab: IOpenTab) => {
    setFileTabs((previous) => {
      const next: IfileTabDict = {};
      // Only one tab is in front, and only a tab being opened now needs loading.
      Object.entries(previous).forEach(([key, open]) => {
        next[key] = { ...open, active: false, load_required: false };
      });
      const existing = next[tab.path];
      next[tab.path] =
        existing === undefined
          ? ({
              ...tab,
              kernelspec: tab.kernelspec ?? 'none',
              extension: tab.extension ?? getFileExtension(tab.name),
              active: true,
              load_required: true,
            } satisfies IfileTab)
          : { ...existing, active: true };
      return next;
    });
  };

  /**
   * Kills the kernels those tabs were running. A notebook tab need not have one: it can be closed
   * while the session is still starting, or after starting one failed.
   */
  const releaseKernels = (paths: string[]) => {
    const ids = paths
      .map((path) => notebookKernelMap[path]?.id)
      .filter((id): id is string => id !== undefined);
    if (ids.length === 0) {
      return;
    }

    ids.forEach((id) => deleteKernel(id).catch(logApiError('Failed to kill kernel:')));
    setNotebookKernelMap((previous) => {
      const next = { ...previous };
      paths.forEach((path) => delete next[path]);
      return next;
    });
    setKernels((previous) => {
      const next = { ...previous };
      ids.forEach((id) => delete next[id]);
      return next;
    });
  };

  const removeTabs = (paths: string[]) => {
    if (paths.length === 0) {
      return;
    }
    releaseKernels(paths);

    setFileTabs((previous) => {
      const next: IfileTabDict = {};
      Object.entries(previous).forEach(([key, tab]) => {
        if (!paths.includes(key)) {
          next[key] = { ...tab, load_required: false };
        }
      });
      // Something has to be in front once a tab goes, and the Launcher is the one tab always there.
      if (next.Launcher) {
        next.Launcher = { ...next.Launcher, active: true };
      }
      return next;
    });

    setTerminals((previous) => {
      const next = { ...previous };
      paths.forEach((path) => delete next[path]);
      return next;
    });
  };

  return {
    openTab,

    openDiff: (target: DiffTarget) => {
      // Which comparison, in the tab name: two diffs of one file are two tabs, and a strip of tabs all
      // called `notes.txt (diff)` cannot be told apart.
      const against =
        target.ref !== undefined
          ? target.ref.slice(0, 7)
          : target.staged === true
            ? 'staged'
            : 'diff';
      openTab({
        name: `${baseName(target.path)} (${against})`,
        path: diffTabKey(target),
        type: 'diff',
        diff: target,
        // From the file rather than from the name, which ends in the comparison: the status bar prints
        // this, and `txt (diff)` is not a kind of file.
        extension: getFileExtension(baseName(target.path)),
      });
    },

    openTerminal: (cwd?: string) => {
      // Numbered rather than named after the folder: the tab is keyed by this name, and two
      // terminals in the same folder are two terminals.
      const name = `Terminal ${terminalCount + 1}`;
      setTerminalCount(terminalCount + 1);
      setTerminals((previous) => ({ ...previous, [name]: { id: name, name } }));
      openTab({ name, path: name, type: 'terminal', cwd });
    },

    closeTab: (path: string) => removeTabs([path]),

    closeDeleted: (path: string) =>
      removeTabs(Object.keys(fileTabs).filter((key) => isInside(key, path))),

    renameTab: (oldPath: string, newPath: string) => {
      setFileTabs((previous) => {
        const next: IfileTabDict = {};
        // Rebuilt in order rather than reassigned: the key is the path, so a rename is a new key,
        // and the tab has to stay where it was in the strip.
        Object.entries(previous).forEach(([key, tab]) => {
          const moved = rewritePath(key, oldPath, newPath);
          if (moved === null) {
            next[key] = tab;
          } else {
            next[moved] = { ...tab, path: moved, name: baseName(moved) };
          }
        });
        return next;
      });

      setNotebookKernelMap((previous) => {
        const next: typeof previous = {};
        Object.entries(previous).forEach(([key, kernel]) => {
          next[rewritePath(key, oldPath, newPath) ?? key] = kernel;
        });
        return next;
      });
    },
  };
}
