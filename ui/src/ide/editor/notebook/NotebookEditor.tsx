import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { search } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { useAtom, useAtomValue } from 'jotai';
import { toast } from 'react-toastify';
import './NotebookEditor.scss';

import {
  apiErrorMessage,
  DATAFRAMES,
  downloadContent,
  isSaveConflict,
  logApiError,
  NotebookMetadata,
  NotebookModel,
  prepareConnection,
  saveNotebook,
} from '@/api';
import DiskChangeBand from '../DiskChangeBand';
import { CellConflict, CellHeld, NotebookDiskBand } from './DiskNotices';
import { useNotebookDisk } from './useNotebookDisk';
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
import { findRunCell, KernelMessage, PlacedRun, ReplayedRun } from './kernelMessages';
import KernelSwitcher from './KernelSwitch';
import NbButtons from './NbButtons';
import { insertCellRequestAtom } from '@/store/editorRequests';
import { freeFrameName, parseSqlCell, withSqlOptions } from './sqlCell';
import { useAskTrust } from '@/store/trust';
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
import { cellMention, outputMention, useAddMention } from '@/ide/agents/mentions';

interface NotebookEditorProps {
  data: FileTab;
}

export default function NotebookEditor({ data }: NotebookEditorProps) {
  const cells = useNotebookCells();
  const { loadNotebook, markCellRunning, notebook } = cells;
  const [editorSettings] = useEditorSettings();
  const kernelspecs = useAtomValue(kernelspecsAtom);

  /** Which cell a run started somewhere else belongs to, or undefined when that cannot be told. */
  const handleExternalExecute = useCallback(
    (code: string, cellId?: string): string | undefined => {
      const ran = findRunCell(notebook.cells, cellId, code);
      if (ran) {
        markCellRunning(ran);
      }
      return ran;
    },
    [notebook.cells, markCellRunning]
  );

  /** Runs the server kept while this tab was not listening, matched to their cells by the same rule. */
  const { applyReplay } = cells;
  const handleReplay = useCallback(
    (runs: ReplayedRun[]): PlacedRun[] => {
      const placed = runs.flatMap((run) => {
        const cellId = findRunCell(notebook.cells, run.cell_id, run.code);
        return cellId ? [{ cellId, run }] : [];
      });
      if (placed.length > 0) {
        applyReplay(placed);
      }
      return placed;
    },
    [notebook.cells, applyReplay]
  );

  const kernel = useKernelSession(data, cells.applyMessage, handleExternalExecute, handleReplay);
  const { startSessionForNotebook } = kernel;

  // The attached kernel's language first, then what the file says it was written in.
  const savedKernelspec = notebook.metadata.kernelspec;
  const languageName =
    kernel.kernelLanguage ??
    notebook.metadata.language_info?.name ??
    (typeof savedKernelspec === 'object' ? savedKernelspec?.language : undefined);
  const cellLanguage = useCellLanguage(languageName);
  const cellLanguageName = languageName?.trim().toLowerCase() || 'python';

  useEffect(() => {
    if (data.load_required === true) {
      // Sequenced, not side by side: the kernel to start is the one the file names, so it takes
      // reading the file to know it — and a notebook that could not be read gets no session, and
      // so no kernel picker raised over the error.
      loadNotebook(data.path).then((loaded) => {
        if (loaded) {
          startSessionForNotebook(loaded.metadata);
        }
      });
    }
  }, [data, loadNotebook, startSessionForNotebook]);

  // The Data panel's "Query this table", for this notebook: a SQL cell below the focused one.
  const [insertRequest, setInsertRequest] = useAtom(insertCellRequestAtom);
  useEffect(() => {
    if (insertRequest === null || insertRequest.path !== data.path) {
      return;
    }
    setInsertRequest(null);
    // A dataframe another cell already writes is left to that cell.
    let source = insertRequest.source;
    const sql = parseSqlCell(source);
    if (sql !== null) {
      const used = notebook.cells.map((cell) => parseSqlCell(cell.source)?.out ?? '');
      source = withSqlOptions(source, { out: freeFrameName(sql.out, used) });
    }
    cells.insertCodeAfter(notebook.cells[cells.focusedIndex]?.id ?? '', source);
  }, [insertRequest, data.path, setInsertRequest, cells, notebook.cells]);

  // The cells' editors, by cell id. Declared here because the disk's reconciliation asks which one has
  // the keyboard; see `registerCellView` below for the rest.
  const cellViews = useRef<Map<string, EditorView>>(new Map());
  const typingIn = useCallback(() => {
    for (const [cellId, view] of cellViews.current) {
      if (view.hasFocus) {
        return cellId;
      }
    }
    return null;
  }, []);
  const cellViewFor = useCallback((cellId: string) => cellViews.current.get(cellId) ?? null, []);
  const disk = useNotebookDisk(data, cells, typingIn, cellViewFor);

  /** The notebook as it is written: the attached kernel recorded in its metadata. */
  const withKernelspec = (written: NotebookModel): NotebookModel => {
    // Merged, not replaced: the server round-trips metadata it does not understand, so replacing
    // the object here would drop language_info and whatever else the file arrived with.
    const metadata: NotebookMetadata = { ...written.metadata };
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
      // Replaced whole, as Jupyter does: it is the running kernel's account of its language.
      if (kernel.languageInfo) {
        metadata.language_info = kernel.languageInfo;
      }
    }
    written.metadata = metadata;
    return written;
  };

  const saveNotebookToDisk = async () => {
    // A cell held for the reader to leave is written as the file has it, not as it was shown.
    let written = withKernelspec(disk.release(null));
    let hash;
    try {
      hash = await saveNotebook(data.path, written, cells.diskHash.current || undefined);
    } catch (failure) {
      const again = isSaveConflict(failure) ? await disk.refuseSave(written) : null;
      if (again === null) {
        throw failure;
      }
      written = withKernelspec(again);
      hash = await saveNotebook(data.path, written, cells.diskHash.current || undefined);
    }
    disk.saved();
    // Only once the write succeeded: a notebook the server refused still holds unsaved work.
    cells.markSaved(written, hash);
  };

  const saveRef = useRef(saveNotebookToDisk);
  saveRef.current = saveNotebookToDisk;
  const { keepAllMine, takeAllTheirs, refused, resolution, clearResolution } = disk;
  const overwrite = useCallback(() => {
    keepAllMine();
    saveRef.current().catch(logSaveFailure);
  }, [keepAllMine]);

  // An answer given in the comparison tab.
  useEffect(() => {
    if (resolution === undefined) {
      return;
    }
    clearResolution();
    if (resolution === 'mine') {
      (refused ? overwrite : keepAllMine)();
    } else {
      void takeAllTheirs();
    }
  }, [resolution, clearResolution, refused, overwrite, keepAllMine, takeAllTheirs]);

  const diskNotices = useMemo(() => {
    const notices: Record<string, React.ReactNode> = {};
    for (const [cellId, theirs] of Object.entries(disk.conflicts)) {
      notices[cellId] = (
        <CellConflict
          path={data.path}
          deleted={theirs === null}
          onCompare={disk.compare}
          onKeepMine={() => disk.keepMine(cellId)}
          onTakeTheirs={() => disk.takeTheirs(cellId)}
        />
      );
    }
    for (const cellId of Object.keys(disk.held)) {
      notices[cellId] = <CellHeld onUpdate={() => disk.release(null)} />;
    }
    return notices;
  }, [disk, data.path]);

  // Registered whether or not this is the active tab: any open tab can be closed.
  useUnsavedChanges(data.path, cells.unsaved, saveNotebookToDisk);

  const { sendExecuteRequest } = kernel;
  const askTrust = useAskTrust();
  /*
   * Runs asked for in a folder that was not trusted, sent once trusting it has started the kernel and its
   * socket is open: before then there is nothing to send them on.
   */
  const heldRuns = useRef<{ source: string; cellId: string }[]>([]);
  const kernelId = kernel.session?.kernel.id;
  /*
   * Sends a run. A SQL cell's connection is handed to the kernel first, password and all, from the server:
   * the notebook names a connection and never holds its credentials. See docs/SQL.md.
   */
  const send = useCallback(
    (source: string, cellId: string) => {
      const sql = parseSqlCell(source);
      if (sql === null || sql.connection === DATAFRAMES || kernelId === undefined) {
        markCellRunning(cellId);
        sendExecuteRequest(source, cellId);
        return;
      }
      prepareConnection(kernelId, sql.connection)
        .then(() => {
          markCellRunning(cellId);
          sendExecuteRequest(source, cellId);
        })
        .catch((error) =>
          toast.error(`Could not use ${sql.connection}: ${apiErrorMessage(error)}`)
        );
    },
    [kernelId, markCellRunning, sendExecuteRequest]
  );
  const submitCell = useCallback(
    (source: string, cellId: string) => {
      if (kernel.restricted) {
        askTrust({
          reason: 'run',
          notebook: data.name,
          kernel: kernel.kernelDisplayName ?? kernel.kernelName,
          onTrusted: () => heldRuns.current.push({ source, cellId }),
        });
        return;
      }
      send(source, cellId);
    },
    [send, kernel.restricted, kernel.kernelDisplayName, kernel.kernelName, askTrust, data.name]
  );
  useEffect(() => {
    if (kernel.connection?.readyState !== WebSocket.OPEN || heldRuns.current.length === 0) {
      return;
    }
    const runs = heldRuns.current;
    heldRuns.current = [];
    runs.forEach(({ source, cellId }) => send(source, cellId));
  }, [kernel.connection, send]);

  const submitPrompt = (parentHeader: KernelMessage, inputValue: string) => {
    // Which cell the kernel is waiting on is resolved by the kernel session: the prompt itself
    // carries a message id, not a cell.
    if (kernel.promptCellId) {
      cells.clearCellOutputs(kernel.promptCellId);
    }
    kernel.sendInputReply(parentHeader, inputValue);
  };

  const submitAllCellsForExecution = useCallback(() => {
    if (kernel.restricted) {
      askTrust({
        reason: 'run',
        notebook: data.name,
        kernel: kernel.kernelDisplayName ?? kernel.kernelName,
        onTrusted: () =>
          notebook.cells.forEach((cell) => {
            if (cell.cell_type === 'code') {
              heldRuns.current.push({ source: cell.source, cellId: cell.id });
            }
          }),
      });
      return;
    }
    if (kernel.session) {
      notebook.cells.forEach((cell) => {
        if (cell.cell_type === 'code') {
          submitCell(cell.source, cell.id);
        }
      });
    }
  }, [
    kernel.session,
    kernel.restricted,
    kernel.kernelDisplayName,
    kernel.kernelName,
    askTrust,
    data.name,
    notebook,
    submitCell,
  ]);

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
    unsaved: cells.unsaved,
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

  const addMention = useAddMention();
  const commands = useNotebookCommands({
    cells,
    kernel,
    // A keystroke has nowhere to report a failed save, so it goes to the console; the close prompt
    // awaits the same promise and shows the reason instead.
    saveNotebook: () => {
      saveNotebookToDisk().catch(logSaveFailure);
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
    mentionFocusedCell: (what) => {
      const cell = notebook.cells[cells.focusedIndex];
      if (cell !== undefined) {
        const mention = what === 'cell' ? cellMention : outputMention;
        addMention(mention(data.path, cell, cells.focusedIndex));
      }
    },
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
    insertCodeAfter: useStableCallback(cells.insertCodeAfter),
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
      cellLanguageName,
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
      kernelId: kernel.session?.kernel.id,
      notebookPath: data.path,
    }),
    // `stable`'s members never change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      commandKeymap,
      cellLanguage,
      cellLanguageName,
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
      kernel.session?.kernel.id,
      data.path,
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
        {disk.wholeConflict !== null ? (
          <DiskChangeBand
            path={data.path}
            name={data.name}
            refused={refused}
            by={refused ? undefined : disk.changedBy}
            onCompare={disk.compare}
            onKeepMine={refused ? overwrite : keepAllMine}
            onTakeTheirs={takeAllTheirs}
          />
        ) : (
          disk.asking && (
            <NotebookDiskBand
              name={data.name}
              conflicts={Object.keys(disk.conflicts).length}
              refused={refused}
              by={disk.changedBy}
              onGoTo={() => cells.focusCellBox(Object.keys(disk.conflicts)[0])}
            />
          )
        )}
        <NbButtons
          run={runCommand}
          downloadNotebook={downloadNotebook}
          cellType={cellTypeOf(notebook.cells[cells.focusedIndex])}
          contentsShown={showContents}
          kernelName={kernel.kernelName}
          kernelDisplayName={kernel.kernelDisplayName}
          kernelStatus={kernel.kernelStatus}
          restricted={kernel.restricted}
          onRestricted={() => askTrust({ reason: 'open' })}
        />
        {kernel.restricted && (
          <div className="z-notice notebook-restricted">
            <Icon name="shield" size={14} />
            <p>
              <strong>Restricted mode.</strong> You can read every file, notebook and output here;
              nothing in this folder runs until you trust it.
            </p>
            <button
              type="button"
              className="z-button z-button-secondary z-notice-action"
              onClick={() => askTrust({ reason: 'open' })}
            >
              Trust folder…
            </button>
          </div>
        )}

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
                    timings={cells.timings}
                    ranBy={cells.ranBy}
                    expandedOutputs={cells.expandedOutputs}
                    editingCellId={cells.editingCellId}
                    focusedCellId={cells.focusedCellId}
                    diskNotices={diskNotices}
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

/** What the cell type select shows: `sql` for a code cell that is a SQL cell. */
function cellTypeOf(cell: { cell_type: string; source: string } | undefined): string {
  if (cell === undefined) {
    return '';
  }
  return cell.cell_type === 'code' && parseSqlCell(cell.source) !== null ? 'sql' : cell.cell_type;
}

/** A refused save is said in the band, not the console. */
function logSaveFailure(failure: unknown) {
  if (!isSaveConflict(failure)) {
    logApiError('Error saving notebook:')(failure);
  }
}
