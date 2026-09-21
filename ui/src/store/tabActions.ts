import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';

import { deleteKernel, DiffTarget, logApiError } from '@/api';
import { trackTabOpened } from '@/telemetry';
import getFileExtension from '@/ide/utils';
import { baseName, isInside, rewritePath } from '@/paths';
import { diskCompareTabKey } from '@/store/diskChanges';
import { helpAboutRequestAtom } from '@/store/helpTab';
import { searchPreviewTabKey } from '@/store/projectSearch';
import { notebookKernelMapAtom } from '@/store/kernels';
import { recentFilesAtom, withRecent } from '@/store/recentFiles';
import { currentTerminalAtom, terminalsAtom, terminalsCountAtom } from '@/store/terminals';
import { dockOpenAtom, dockTabAtom } from '@/store/languageServers';
import {
  fileTabsAtom,
  FileTab,
  FileTabDict,
  tabGroupsAtom,
  withActive,
  withoutTabs,
} from './tabState';

/** What a caller has to say to open a tab; the rest of FileTab follows from it. */
export interface OpenTab {
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

/** The Help tab's key. Not a path, so there is one Help tab and a file called `Help` is not it. */
export const HELP_TAB_KEY = 'zasper:help';

/** The Settings tab's key, for the same reason. */
export const SETTINGS_TAB_KEY = 'zasper:settings';

/**
 * The tabs a close took, oldest first, for Reopen Closed Tab. Terminals are not kept: reopening one
 * would be a new shell wearing an old name, which is why a terminal is not restored across a reload
 * either. Unsaved edits are not kept — they live in the editor that went — so a reopened file is the
 * file as it is on disk.
 */
export const closedTabsAtom = atom<OpenTab[]>([]);

const REOPENABLE = new Set(['file', 'notebook', 'diff', 'help', 'settings']);

/** How many closes back Reopen can reach. */
const CLOSED_TABS_KEPT = 10;

export interface TabActions {
  /** Opens a tab, or brings it to the front when that path is already open. */
  openTab: (tab: OpenTab) => void;
  /**
   * Brings an open tab to the front. A tab restored from a previous session reads its file the first
   * time this reaches it; one that has already loaded is only raised, so an unsaved buffer survives
   * being switched away from.
   */
  activateTab: (path: string) => void;
  /** Opens the two sides of one file's comparison, or brings that comparison to the front. */
  openDiff: (target: DiffTarget) => void;
  /** Opens a new terminal, in `cwd` if one is given. */
  openTerminal: (cwd?: string) => void;
  /** Brings a shell already open in this window to the front of the panel under the editor. */
  showTerminal: (name: string) => void;
  /** Shows the terminals in the panel under the editor, starting one only when none is running. */
  showTerminals: () => void;
  /** Opens the Help tab or brings it to the front; `about` also scrolls it to About. */
  openHelp: (section?: 'about') => void;
  /** Opens the Settings tab or brings it to the front. */
  openSettings: () => void;
  /** Opens the comparison of a file's unsaved edits with the version of it now on disk. */
  openDiskCompare: (path: string) => void;
  /** Opens a file on disk against the file after the search panel's replace. */
  openSearchPreview: (path: string) => void;
  /** Opens what a language's server has written to its log. */
  openLanguageServerLog: (server: string, name: string) => void;
  /** Opens the last tab a close took, newest first. */
  reopenClosedTab: () => void;
  /**
   * Closes a tab. A notebook's kernel keeps running, as it does in JupyterLab: reopening the notebook
   * plugs back into that session, with everything still in memory.
   */
  closeTab: (path: string) => void;
  /**
   * Closes several tabs at once, kernels left running as `closeTab` leaves them. If the tab in front
   * goes, `focus` comes to the front when it is still open, and the Launcher otherwise.
   */
  closeTabs: (paths: string[], focus?: string) => void;
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
export function useTabActions(): TabActions {
  const fileTabs = useAtomValue(fileTabsAtom);
  const setFileTabs = useSetAtom(fileTabsAtom);
  const notebookKernelMap = useAtomValue(notebookKernelMapAtom);
  const setNotebookKernelMap = useSetAtom(notebookKernelMapAtom);
  const [terminals, setTerminals] = useAtom(terminalsAtom);
  const setCurrentTerminal = useSetAtom(currentTerminalAtom);
  const setDockOpen = useSetAtom(dockOpenAtom);
  const setDockTab = useSetAtom(dockTabAtom);
  const terminalCount = useAtomValue(terminalsCountAtom);
  const setTerminalCount = useSetAtom(terminalsCountAtom);
  const setHelpAboutRequest = useSetAtom(helpAboutRequestAtom);
  const closedTabs = useAtomValue(closedTabsAtom);
  const setClosedTabs = useSetAtom(closedTabsAtom);
  const setRecentFiles = useSetAtom(recentFilesAtom);
  const setTabGroups = useSetAtom(tabGroupsAtom);

  /**
   * Brings a shell to the front of the panel under the editor, opening the panel if it is closed.
   *
   * A terminal was once a tab, and exactly one tab is in front, so opening a shell put away the
   * code it was opened to run something against.
   */
  const showTerminal = (name: string) => {
    setCurrentTerminal(name);
    setDockTab('terminal');
    setDockOpen(true);
  };

  const openTerminal = (cwd?: string) => {
    // Numbered rather than named after the folder: two terminals in the same folder are two
    // terminals, and the name is what the server reports them by.
    const name = `Terminal ${terminalCount + 1}`;
    setTerminalCount(terminalCount + 1);
    setTerminals((previous) => ({ ...previous, [name]: { id: name, name, cwd } }));
    showTerminal(name);
  };

  const openTab = (tab: OpenTab) => {
    // Outside the updater, which React may run more than once. `fileTabs` is the render's snapshot, so
    // a tab opened twice in one tick counts twice — better than a side effect inside a state updater.
    if (fileTabs[tab.path] === undefined) {
      trackTabOpened(tab.type, tab.name);
    }

    // Only the two kinds that are a file on disk, and on every open rather than the first: opening one
    // again is what makes it the most recent.
    if (tab.type === 'file' || tab.type === 'notebook') {
      const opened = { path: tab.path, name: tab.name, type: tab.type };
      setRecentFiles((files) => withRecent(files, opened));
    }

    setFileTabs((previous) => {
      // Inserted unloaded, then activated: `withActive` is the one place that decides what loads, so a
      // tab opened now and a restored tab reached for the first time take the same path.
      const opened =
        previous[tab.path] === undefined
          ? {
              ...previous,
              [tab.path]: {
                ...tab,
                kernelspec: tab.kernelspec ?? 'none',
                extension: tab.extension ?? getFileExtension(tab.name),
                active: false,
                load_required: false,
                unloaded: true,
              } satisfies FileTab,
            }
          : previous;
      return withActive(opened, tab.path);
    });
  };

  /**
   * Kills the kernels running those paths. Only a deleted file's, now: closing a tab leaves its kernel
   * alive. A path need not have one — a notebook can be closed while its session is still starting, or
   * after starting one failed.
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
  };

  const removeTabs = (paths: string[], focus?: string) => {
    if (paths.length === 0) {
      return;
    }

    // Read from this render's tabs, before they go: what it takes to open each of them again.
    const closed = paths
      .map((path) => fileTabs[path])
      .filter((tab) => tab !== undefined && REOPENABLE.has(tab.type))
      .map((tab) => ({
        name: tab.name,
        path: tab.path,
        type: tab.type,
        extension: tab.extension,
        kernelspec: tab.kernelspec,
        diff: tab.diff,
      }));
    if (closed.length > 0) {
      setClosedTabs((previous) => [...previous, ...closed].slice(-CLOSED_TABS_KEPT));
    }

    // The half being worked in; `withoutTabs` is what leaves something in front of it.
    setFileTabs((previous) => withoutTabs(previous, paths, focus));

    setTerminals((previous) => {
      const next = { ...previous };
      paths.forEach((path) => delete next[path]);
      return next;
    });
  };

  return {
    openTab,

    activateTab: (path: string) => setFileTabs((previous) => withActive(previous, path)),

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

    openTerminal,

    showTerminal,

    showTerminals: () => {
      if (Object.keys(terminals).length === 0) {
        openTerminal();
      } else {
        setDockTab('terminal');
        setDockOpen(true);
      }
    },

    openHelp: (section?: 'about') => {
      openTab({ name: 'Help', path: HELP_TAB_KEY, type: 'help', extension: null });
      if (section === 'about') {
        setHelpAboutRequest((count) => count + 1);
      }
    },

    openSettings: () => {
      openTab({ name: 'Settings', path: SETTINGS_TAB_KEY, type: 'settings', extension: null });
    },

    openDiskCompare: (path: string) => {
      openTab({
        name: `${baseName(path)} (on disk)`,
        path: diskCompareTabKey(path),
        type: 'disk-diff',
        extension: getFileExtension(baseName(path)),
      });
    },

    openSearchPreview: (path: string) => {
      openTab({
        name: `${baseName(path)} (replace)`,
        path: searchPreviewTabKey(path),
        type: 'search-preview',
        extension: getFileExtension(baseName(path)),
      });
    },

    openLanguageServerLog: (server: string, name: string) => {
      openTab({ name: `${name} log`, path: `lsp-log:${server}`, type: 'lsp-log', extension: null });
    },

    reopenClosedTab: () => {
      const last = closedTabs[closedTabs.length - 1];
      if (last === undefined) {
        return;
      }
      setClosedTabs((previous) => previous.slice(0, -1));
      openTab(last);
    },

    closeTab: (path: string) => removeTabs([path]),

    closeTabs: (paths: string[], focus?: string) => removeTabs(paths, focus),

    closeDeleted: (path: string) => {
      // The one close that does take the kernel with it: the file is gone, so there is no reopening the
      // notebook to reach the kernel again, and a session on a path that no longer exists is one the
      // server would hand back to a new file of the same name. Walking the kernels rather than the tabs
      // because a kernel now outlives its tab — the notebook may have been closed hours ago.
      releaseKernels(Object.keys(notebookKernelMap).filter((key) => isInside(key, path)));
      // Out of every half, because a file can be open in more than one — and not remembered as a
      // closed tab either: reopening something that is gone is an editor saying it cannot be loaded.
      setTabGroups((groups) =>
        groups.map((group) => ({
          ...group,
          tabs: withoutTabs(
            group.tabs,
            Object.keys(group.tabs).filter((key) => isInside(key, path))
          ),
        }))
      );
      setRecentFiles((files) => files.filter((file) => !isInside(file.path, path)));
    },

    renameTab: (oldPath: string, newPath: string) => {
      // The record follows the file: a recent path that no longer exists opens as "could not be loaded".
      setRecentFiles((files) =>
        files.map((file) => {
          const moved = rewritePath(file.path, oldPath, newPath);
          return moved === null ? file : { ...file, path: moved, name: baseName(moved) };
        })
      );

      // In every half: a renamed file that is open twice is the same file twice, and a tab left on the
      // old path would recreate it on its next save.
      setTabGroups((groups) =>
        groups.map((group) => {
          const next: FileTabDict = {};
          // Rebuilt in order rather than reassigned: the key is the path, so a rename is a new key,
          // and the tab has to stay where it was in the strip.
          Object.entries(group.tabs).forEach(([key, tab]) => {
            const moved = rewritePath(key, oldPath, newPath);
            if (moved === null) {
              next[key] = tab;
            } else {
              next[moved] = { ...tab, path: moved, name: baseName(moved) };
            }
          });
          return { ...group, tabs: next };
        })
      );

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
