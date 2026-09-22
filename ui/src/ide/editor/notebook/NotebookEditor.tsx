import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { search } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { toast } from 'react-toastify';
import './NotebookEditor.scss';

import {
  apiErrorMessage,
  downloadContent,
  getNotebook,
  logApiError,
  NotebookMetadata,
  saveNotebook,
} from '@/api';
import DiskChangeBand from '../DiskChangeBand';
import { useContentWatcher } from '@/ide/useContentWatcher';
import { diskComparesAtom, diskResolutionsAtom } from '@/store/diskChanges';
import { saveAs } from '@/browser';
import { Icon } from '@/ide/icons';
import { FileTab } from '@/store/tabState';
import { useUnsavedChanges } from '@/store/unsavedState';
import { useEditorSettings } from '@/store/editorSettingsActions';
import { interpreterOfKernel } from '@/lsp/settings';
import { kernelspecsAtom } from '@/store/kernels';
import BreadCrumb from '../BreadCrumb';
import { cellFindHighlighter, currentMatchField } from '../findHighlight';
import ConfirmRestartDialog, { RestartIntent } from './ConfirmRestartDialog';
import { NO_KERNEL } from './kernelChoice';
import { KernelMessage } from './kernelMessages';
import KernelSwitcher from './KernelSwitch';
import NbButtons from './NbButtons';
import NotebookCells from './NotebookCells';
import NotebookFindCard from './NotebookFindCard';
import NotebookOutline from './NotebookOutline';
import { notebookHeadings } from './notebookHeadings';
import { markOutputs } from './outputMarks';
import { NotebookEditorContext, NotebookEditorContextValue } from './NotebookEditorContext';

import { useRegisterCommands, useRunCommand } from '@/commands/registry';
import { useEditorCommandKeymap } from '@/commands/useEditorCommandKeymap';
import { useNotebookCommands } from './notebookCommands';
import { useKernelSession } from './useKernelSession';
import { useCellLanguage } from './useCellLanguage';
import { useNotebookExport } from './export/useNotebookExport';
import ExportDialog from './export/ExportDialog';
import { exportFilename } from './export/exportFormats';
import { useNotebookCells } from './useNotebookCells';
import { useNotebookLanguageServer } from './useNotebookLanguageServer';
import { useNotebookFormatting } from './useNotebookFormatting';
import { useNotebookReplace } from './useNotebookReplace';
import { useNotebookReveal } from './useNotebookReveal';
import { useStableCallback } from './useStableCallback';
import { useNotebookFind } from './useNotebookFind';

interface NotebookEditorProps {
  data: FileTab;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export default function NotebookEditor({ data }: NotebookEditorProps) {
  const cells = useNotebookCells();
  const { loadNotebook, markCellRunning, notebook } = cells;
  const [editorSettings] = useEditorSettings();
  const kernelspecs = useAtomValue(kernelspecsAtom);

  const handleExternalExecute = useCallback(
    (code: string, cellId?: string): string | undefined => {
      if (cellId) {
        const found = notebook.cells.find((c) => c.id === cellId);
        if (found) {
          markCellRunning(found.id);
          return found.id;
        }
      }
      const trimmed = code.trim();
      if (!trimmed) return undefined;
      const matched = notebook.cells.find(
        (c) => c.cell_type === 'code' && c.source.trim() === trimmed
      );
      if (matched) {
        markCellRunning(matched.id);
        return matched.id;
      }
      return undefined;
    },
    [notebook.cells, markCellRunning]
  );

  const kernel = useKernelSession(data, cells.applyMessage, handleExternalExecute);
  const { startSessionForNotebook } = kernel;

  // The attached kernel's language first, then what the file says it was written in.
  const savedKernelspec = notebook.metadata.kernelspec;
  const languageName =
    kernel.kernelLanguage ??
    notebook.metadata.language_info?.name ??
    (typeof savedKernelspec === 'object' ? savedKernelspec?.language : undefined);
  const cellLanguage = useCellLanguage(languageName);

  useEffect(() => {
    if (data.load_required === true) {
      // Sequenced, not side by side: the kernel to start is the one the file names, so it takes
      // reading the file to know it — and a notebook that could not be read gets no session, and
      // so no kernel picker raised over the error.
      loadNotebook(data.path).then((loaded) => {
        if (loaded) {
          diskContent.current = JSON.stringify(loaded, null, 2) + '\n';
          startSessionForNotebook(loaded.metadata);
        }
      });
    }
  }, [data, loadNotebook, startSessionForNotebook]);

  const diskContent = useRef<string | null>(null);
  const changedWhileHidden = useRef(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const setCompares = useSetAtom(diskComparesAtom);
  const [resolution] = useAtom(
    useMemo(() => selectAtom(diskResolutionsAtom, (all) => all[data.path]), [data.path])
  );
  const setResolutions = useSetAtom(diskResolutionsAtom);

  const saveNotebookToDisk = async () => {
    // Merged, not replaced: the server round-trips metadata it does not understand, so replacing
    // the object here would drop language_info and whatever else the file arrived with.
    const metadata: NotebookMetadata = { ...notebook.metadata };
    // Only a kernel that is actually attached: writing the 'none' placeholder would replace the
    // kernel the file remembers with a name that starts nothing.
    if (kernel.kernelName && kernel.kernelName !== NO_KERNEL) {
      const saved = metadata.kernelspec;
      // Left alone when the file already names the attached kernel: its record carries more than a
      // name, and rebuilding it from the kernel's name is how `Python 3` became `python3`.
      if (typeof saved !== 'object' || saved === null || saved.name !== kernel.kernelName) {
        metadata.kernelspec = {
          name: kernel.kernelName,
          display_name: kernel.kernelDisplayName ?? kernel.kernelName,
          // Only when the kernelspec actually declares one — nbformat allows the key to be absent,
          // but a `language: undefined` would serialise as a null and be worse than leaving it out.
          ...(kernel.kernelLanguage ? { language: kernel.kernelLanguage } : {}),
        };
      }
    }
    notebook.metadata = metadata;

    const written = notebook;
    await saveNotebook(data.path, written);
    diskContent.current = JSON.stringify(written, null, 2) + '\n';
    setConflict(null);
    // Only once the write succeeded: a notebook the server refused still holds unsaved work.
    cells.markSaved(written);
  };

  const takeChangeFromDisk = useCallback(async () => {
    let resJson;
    try {
      resJson = await getNotebook(data.path);
    } catch {
      return;
    }
    const onDisk = JSON.stringify(resJson.content, null, 2) + '\n';
    if (onDisk === diskContent.current) {
      return;
    }
    diskContent.current = onDisk;

    if (!cells.sourceUnsaved) {
      setConflict(null);
      await loadNotebook(data.path);
      return;
    }

    const currentDoc = JSON.stringify(cells.notebook, null, 2) + '\n';
    // Someone wrote what the editor already holds: nothing is left to choose between.
    if (currentDoc === onDisk) {
      setConflict(null);
      cells.markSaved(resJson.content);
      return;
    }

    setConflict(onDisk);
  }, [data.path, cells, loadNotebook]);

  useContentWatcher(() => {
    if (!data.active) {
      changedWhileHidden.current = true;
      return;
    }
    void takeChangeFromDisk();
  });

  useEffect(() => {
    if (data.active && changedWhileHidden.current) {
      changedWhileHidden.current = false;
      void takeChangeFromDisk();
    }
  }, [data.active, takeChangeFromDisk]);

  const keepMine = useCallback(() => setConflict(null), []);

  const takeTheirs = useCallback(async () => {
    if (conflict === null) {
      return;
    }
    diskContent.current = conflict;
    setConflict(null);
    await loadNotebook(data.path);
  }, [conflict, data.path, loadNotebook]);

  const compareWithDisk = useCallback(() => {
    if (conflict !== null) {
      const mine = JSON.stringify(cells.notebook, null, 2) + '\n';
      setCompares((compares) => ({ ...compares, [data.path]: { onDisk: conflict, mine } }));
    }
  }, [conflict, cells.notebook, data.path, setCompares]);

  useEffect(() => {
    if (conflict === null) {
      setCompares((compares) => without(compares, data.path));
    }
  }, [conflict, data.path, setCompares]);

  // An answer given in the comparison tab.
  useEffect(() => {
    if (resolution === undefined) {
      return;
    }
    setResolutions((resolutions) => without(resolutions, data.path));
    if (resolution === 'mine') {
      keepMine();
    } else {
      void takeTheirs();
    }
  }, [resolution, data.path, setResolutions, keepMine, takeTheirs]);

  // Registered whether or not this is the active tab: any open tab can be closed.
  useUnsavedChanges(data.path, cells.unsaved, saveNotebookToDisk);

  const { sendExecuteRequest } = kernel;
  const submitCell = useCallback(
    (source: string, cellId: string) => {
      markCellRunning(cellId);
      sendExecuteRequest(source, cellId);
    },
    [markCellRunning, sendExecuteRequest]
  );

  const submitPrompt = (parentHeader: KernelMessage, inputValue: string) => {
    // Which cell the kernel is waiting on is resolved by the kernel session: the prompt itself
    // carries a message id, not a cell.
    if (kernel.promptCellId) {
      cells.clearCellOutputs(kernel.promptCellId);
    }
    kernel.sendInputReply(parentHeader, inputValue);
  };

  const submitAllCellsForExecution = useCallback(() => {
    if (kernel.session) {
      notebook.cells.forEach((cell) => {
        if (cell.cell_type === 'code') {
          submitCell(cell.source, cell.id);
        }
      });
    }
  }, [kernel.session, notebook, submitCell]);

  // Run all after a restart waits for the render that carries the new kernel's session: the callbacks
  // from before the restart still hold the old one.
  const [runAllAfterRestart, setRunAllAfterRestart] = useState(false);
  useEffect(() => {
    if (runAllAfterRestart && kernel.session) {
      setRunAllAfterRestart(false);
      submitAllCellsForExecution();
    }
  }, [runAllAfterRestart, kernel.session, submitAllCellsForExecution]);

  const doRestartKernel = () => {
    kernel.restartKernel().catch((error) => console.error('Error restarting kernel:', error));
  };

  const doRestartAndExecuteAllCells = async () => {
    if (!kernel.session) return;

    try {
      // The new kernel has to be connected before any cell is submitted.
      await kernel.restartKernel();
      setRunAllAfterRestart(true);
    } catch (error) {
      console.error('Error restarting kernel:', error);
    }
  };

  // Both restarts are asked about first. They were a single click each, and both throw away
  // everything the kernel holds; run-all also replaces every output in the file, which no undo here
  // covers. `null` means nothing is being asked.
  const [restartIntent, setRestartIntent] = useState<RestartIntent | null>(null);

  const confirmRestart = () => {
    const intent = restartIntent;
    setRestartIntent(null);
    if (intent === 'restart') {
      doRestartKernel();
    } else if (intent === 'restart-and-run-all') {
      doRestartAndExecuteAllCells().catch(logApiError('Error restarting kernel:'));
    }
  };

  // Every action this notebook offers, in one list — this is what the toolbars dispatch, what the
  // palette lists and what the keyboard resolves. It replaced a `keydown` handler here, another in
  // useNotebookCells, and a keymap in Cell, which between them disagreed about Shift-Enter and made
  // a capital M untypable.
  /**
   * Every cell's editor, by cell id, for the notebook's own find.
   *
   * A ref rather than state: a view arriving is not a render, and the find card asks for them only
   * when it searches. Cleared by the cell as it unmounts, so a stale view is never dispatched into.
   */
  const cellViews = useRef<Map<string, EditorView>>(new Map());
  const [viewsVersion, setViewsVersion] = useState(0);
  const viewFor = useCallback((cellId: string) => cellViews.current.get(cellId) ?? null, []);

  const languageServer = useNotebookLanguageServer({
    path: data.path,
    kernelLanguage: languageName,
    interpreter: interpreterOfKernel(kernelspecs[kernel.kernelName ?? '']),
    cells: notebook.cells,
    loaded: !cells.loading && cells.error === '',
    viewFor,
  });
  const languageServerRef = useRef(languageServer);
  languageServerRef.current = languageServer;

  const registerCellView = useCallback((cellId: string, view: EditorView | null) => {
    if (view === null) {
      cellViews.current.delete(cellId);
    } else {
      cellViews.current.set(cellId, view);
      setViewsVersion((count) => count + 1);
      // A cell's problems can arrive before its editor does; drawn a tick later, outside its creation.
      window.setTimeout(() => languageServerRef.current?.draw(cellId), 0);
    }
  }, []);

  const kernelStatusRef = useRef(kernel.kernelStatus);
  kernelStatusRef.current = kernel.kernelStatus;
  const kernelIdle = useCallback(() => kernelStatusRef.current === 'idle', []);

  const formatCells = useNotebookFormatting({
    languageServer,
    notebook,
    focusedIndex: cells.focusedIndex,
    cellViews,
    settings: editorSettings,
  });

  // One copy per cell: the library's search state, our highlighter over it — theirs draws nothing
  // unless its own panel is open — and the field through which the notebook says which single match,
  // out of fifty cells, the reader is actually on.
  const findExtension = useMemo(() => [search(), cellFindHighlighter, currentMatchField], []);

  /** The card, and which ⌘F asked for its field. */
  const [finding, setFinding] = useState(false);
  const [findFocus, setFindFocus] = useState(0);
  const [findTakesFocus, setFindTakesFocus] = useState(true);
  const find = useNotebookFind({
    cells: cells.notebook.cells,
    views: cellViews,
    focusCell: cells.focusCell,
    scrollTo: cells.scrollTo,
    active: finding,
    viewsVersion,
  });
  const openFind = useCallback(() => {
    setFindTakesFocus(true);
    setFinding(true);
    setFindFocus((count) => count + 1);
  }, []);
  const openFindForReveal = useCallback(() => {
    setFindTakesFocus(false);
    setFinding(true);
  }, []);

  /**
   * The table of contents beside the cells.
   *
   * It lives as long as the tab does, and opens as Settings says: what should remember it *per
   * notebook* is still an open question, so nothing here writes it anywhere.
   */
  const [showContents, setShowContents] = useState(editorSettings.notebook_contents);
  const headings = useMemo(() => notebookHeadings(cells.notebook), [cells.notebook]);
  const runningIndexes = useMemo(
    () =>
      cells.notebook.cells.flatMap((cell, index) =>
        kernel.runningCellIds.has(cell.id) ? [index] : []
      ),
    [cells.notebook, kernel.runningCellIds]
  );

  /**
   * The matches inside the outputs, which are HTML rather than editors.
   *
   * Runs again when the cells change as well as when the query does: a cell that has just run has new
   * output, and the marks are ranges over text that no longer exists.
   */
  const notebookBody = useRef<HTMLDivElement>(null);
  useEffect(() => {
    markOutputs(notebookBody.current, finding && find.options.outputs ? find.query : null);
  }, [finding, find.options.outputs, find.query, cells.notebook.cells]);

  useNotebookReplace({
    path: data.path,
    notebook,
    ready: !cells.loading && cells.error === '',
    cellViews,
    updateCellSource: cells.updateCellSource,
  });

  useNotebookReveal({
    path: data.path,
    notebook,
    loading: cells.loading,
    editingCellId: cells.editingCellId,
    focusCell: cells.focusCell,
    scrollTo: cells.scrollTo,
    find,
    finding,
    openFindForReveal,
    cellViews,
    viewsVersion,
  });

  // The notebook as it is on screen, not as it is on disk: an export carries unsaved edits and the
  // output the kernel produced a moment ago, which is the whole reason the conversion is in the
  // browser rather than in the server.
  const exportNotebook = useNotebookExport({
    notebook,
    name: data.name,
    kernelLanguage: kernel.kernelLanguage,
    kernelDisplayName: kernel.kernelDisplayName,
  });

  /**
   * The `.ipynb` itself, from the server — the file browser's Download row, moved to where someone
   * exporting would now look for it. Deliberately the file *on disk* rather than the three exports
   * above it, which take the notebook on screen: this row's name promises the file, and the tab's
   * dirty dot is what says the two differ.
   */
  const downloadNotebook = () => {
    downloadContent(data.path)
      .then((blob) => saveAs(blob, data.name))
      .catch((error: unknown) => toast.error(apiErrorMessage(error)));
  };

  // Only HTML asks anything before it writes: a dialog for the two
  // things a page can leave out, and Markdown and the script have no equivalent question.
  const [askingExport, setAskingExport] = useState(false);

  const editFocusedCell = () => {
    const cell = notebook.cells[cells.focusedIndex];
    if (cell?.cell_type === 'markdown') {
      cells.beginEditing(cell.id);
    } else if (cell !== undefined) {
      cellViews.current.get(cell.id)?.focus();
    }
  };

  const commands = useNotebookCommands({
    cells,
    kernel,
    // A keystroke has nowhere to report a failed save, so it goes to the console; the close prompt
    // awaits the same promise and shows the reason instead.
    saveNotebook: () => {
      saveNotebookToDisk().catch(logApiError('Error saving notebook:'));
    },
    openFind,
    toggleContents: () => setShowContents((shown) => !shown),
    submitCell,
    submitAllCells: submitAllCellsForExecution,
    formatCells: (scope) => {
      formatCells(scope).catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      );
    },
    hasLanguageServer: languageServer !== null,
    editFocusedCell,
    restartKernel: () => setRestartIntent('restart'),
    restartAndExecuteAllCells: () => setRestartIntent('restart-and-run-all'),
    // The hook reports its own outcome as a toast, so there is nothing for a caller to await.
    exportNotebook: (format) => {
      if (format === 'html') {
        setAskingExport(true);
        return;
      }
      void exportNotebook(format);
    },
  });

  // Only while this is the visible tab: every open notebook stays mounted, and registering
  // unconditionally would let one chord act on all of them at once.
  useRegisterCommands(commands, data.active);
  const runCommand = useRunCommand();

  // Chords CodeMirror would otherwise consume, handed to the cells' editors directly rather than
  // through the registry, so a cell can only run its own notebook's commands.
  const commandKeymap = useEditorCommandKeymap(commands);

  // Stable, so the context below changes only when an extension, the kernel's connection or the
  // language server does — never on a keystroke. Every cell reads it.
  const stable = {
    run: useStableCallback(runCommand),
    focusNextCell: useStableCallback(cells.focusNextCell),
    addCellAt: useStableCallback(cells.addCellAt),
    submitCell: useStableCallback(submitCell),
    interruptKernel: useStableCallback(kernel.interruptKernel),
    submitPrompt: useStableCallback(submitPrompt),
    toggleShowPrompt: useStableCallback(kernel.toggleShowPrompt),
  };
  const cellContext = useMemo<NotebookEditorContextValue>(
    () => ({
      ...stable,
      commandKeymap,
      cellLanguage,
      findExtension,
      registerCellView,
      registerCellBox: cells.registerCellBox,
      focusCell: cells.focusCell,
      focusCellBox: cells.focusCellBox,
      focusPreviousCell: cells.focusPreviousCell,
      updateCellSource: cells.updateCellSource,
      beginEditing: cells.beginEditing,
      endEditing: cells.endEditing,
      requestCompletions: kernel.requestCompletions,
      requestInspection: kernel.requestInspection,
      kernelIdle,
      languageServer,
      widgets: kernel.widgets,
    }),
    // `stable`'s members never change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      commandKeymap,
      cellLanguage,
      findExtension,
      registerCellView,
      cells.registerCellBox,
      cells.focusCell,
      cells.focusCellBox,
      cells.focusPreviousCell,
      cells.updateCellSource,
      cells.beginEditing,
      cells.endEditing,
      kernel.requestCompletions,
      kernel.requestInspection,
      kernelIdle,
      languageServer,
      kernel.widgets,
    ]
  );

  return (
    <div className="tab-surface">
      <div
        className={data.active ? 'editor-pane' : 'editor-pane is-hidden'}
        id="profile"
        role="tabpanel"
        aria-labelledby="profile-tab"
      >
        <BreadCrumb path={data.path} />
        {conflict !== null && (
          <DiskChangeBand
            path={data.path}
            name={data.name}
            onCompare={compareWithDisk}
            onKeepMine={keepMine}
            onTakeTheirs={takeTheirs}
          />
        )}
        <NbButtons
          run={runCommand}
          downloadNotebook={downloadNotebook}
          cellType={notebook.cells[cells.focusedIndex]?.cell_type ?? ''}
          contentsShown={showContents}
          kernelName={kernel.kernelName}
          kernelDisplayName={kernel.kernelDisplayName}
          kernelStatus={kernel.kernelStatus}
        />

        {/* The box the find card hangs off: the cells scroll inside it, and it does not, so the card
            stays under the toolbar wherever the notebook has been scrolled to. */}
        <div className="notebook-area">
          {finding && (
            <NotebookFindCard
              find={find}
              focusRequest={findFocus}
              takeFocus={findTakesFocus}
              onClose={() => setFinding(false)}
            />
          )}
          <div className="notebook-split">
            <div className="notebook-body" ref={notebookBody}>
              {restartIntent !== null && (
                <ConfirmRestartDialog
                  intent={restartIntent}
                  onConfirm={confirmRestart}
                  onCancel={() => setRestartIntent(null)}
                />
              )}

              {askingExport && (
                <ExportDialog
                  filename={exportFilename(data.name, 'html')}
                  onCancel={() => setAskingExport(false)}
                  onExport={(options) => {
                    setAskingExport(false);
                    void exportNotebook('html', options);
                  }}
                />
              )}

              {kernel.showKernelSwitcher && (
                <KernelSwitcher
                  kernelName={kernel.kernelName}
                  error={kernel.kernelError}
                  toggleKernelSwitcher={kernel.toggleKernelSwitcher}
                  changeKernel={kernel.changeKernel}
                />
              )}

              {/* The cells are not offered for editing once a read failed: they would be the empty
              starting state rather than the file. */}
              {cells.error !== '' ? (
                // The band at the top of the pane. No `.z-notice-action`: the answer to an unreadable
                // notebook is to open it as text, which nothing in the app can do yet, and a band with a
                // button that does nothing is worse than one without.
                <div className="z-notice z-notice-error" role="alert">
                  <Icon name="circle-alert" size={14} />
                  <p>
                    <strong>This notebook could not be loaded.</strong> {cells.error}
                  </p>
                </div>
              ) : (
                <NotebookEditorContext.Provider value={cellContext}>
                  <NotebookCells
                    notebook={notebook}
                    runningCellIds={kernel.runningCellIds}
                    expandedOutputs={cells.expandedOutputs}
                    editingCellId={cells.editingCellId}
                    focusedCellId={cells.focusedCellId}
                    prompt={
                      kernel.showPrompt && kernel.promptCellId && kernel.promptContent
                        ? { cellId: kernel.promptCellId, content: kernel.promptContent }
                        : undefined
                    }
                  />
                </NotebookEditorContext.Provider>
              )}
            </div>
            {showContents && (
              <NotebookOutline
                headings={headings}
                focusedIndex={cells.focusedIndex}
                runningIndexes={runningIndexes}
                // The row both scrolls to its cell and focuses it, which is what every other way into
                // a cell does — and it means the table can be walked with the keyboard. It moves what
                // Enter would run next, which is the price.
                //
                // `start`, not the stepping callers' `nearest`: a heading jumped to from the table
                // belongs at the top of the pane with its section under it. `nearest` scrolls the
                // least it can, which for a heading below the fold parks it on the bottom edge with
                // the section it names off screen.
                onGoTo={(index) => {
                  const cell = notebook.cells[index];
                  if (cell !== undefined) {
                    cells.focusCell(cell.id);
                    cells.scrollTo(cell.id, 'start');
                  }
                }}
                onClose={() => setShowContents(false)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
