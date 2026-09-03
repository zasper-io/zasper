import { useAtomValue, useSetAtom } from 'jotai';

import { deleteKernel, logApiError } from '@/api';
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
}

export interface ITabActions {
  /** Opens a tab, or brings it to the front when that path is already open. */
  openTab: (tab: IOpenTab) => void;
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
              extension: getFileExtension(tab.name),
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
