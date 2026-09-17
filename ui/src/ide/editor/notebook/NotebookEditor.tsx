import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { search } from '@codemirror/search';
import { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'react-toastify';
import './NotebookEditor.scss';

import {
  apiErrorMessage,
  downloadContent,
  logApiError,
  NotebookMetadata,
  saveNotebook,
} from '@/api';
import { saveAs } from '@/browser';
import { Icon } from '@/ide/icons';
import { FileTab } from '@/store/tabState';
import { LineEdit, OpenDocument, useOpenDocument } from '@/store/openDocuments';
import { MatchReveal, revealMatchAtom } from '@/store/projectSearch';
import { useUnsavedChanges } from '@/store/unsavedState';
import { useEditorSettings } from '@/store/editorSettingsActions';
import BreadCrumb from '../BreadCrumb';
import { cellFindHighlighter, currentMatchField } from '../findHighlight';
import { editedText, lineEditChanges } from '../lineEdits';
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
import { outputText, useNotebookFind } from './useNotebookFind';

interface NotebookEditorProps {
  data: FileTab;
}

export default function NotebookEditor({ data }: NotebookEditorProps) {
  const [executeAllCellsFlag, setExecuteAllCellsFlag] = useState<boolean>(false);

  const cells = useNotebookCells();
  const kernel = useKernelSession(data, cells.applyMessage);

  const { loadNotebook, notebook } = cells;
  const { startSessionForNotebook } = kernel;

  // The attached kernel's language first, then what the file says it was written in.
  const savedKernelspec = notebook.metadata.kernelspec;
  const cellLanguage = useCellLanguage(
    kernel.kernelLanguage ??
      notebook.metadata.language_info?.name ??
      (typeof savedKernelspec === 'object' ? savedKernelspec?.language : undefined)
  );

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
    // Only once the write succeeded: a notebook the server refused still holds unsaved work.
    cells.markSaved(written);
  };

  // Registered whether or not this is the active tab: any open tab can be closed.
  useUnsavedChanges(data.path, cells.unsaved, saveNotebookToDisk);

  const { markCellRunning } = cells;
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
      setExecuteAllCellsFlag(true);
      notebook.cells.forEach((cell) => {
        if (cell.cell_type === 'code') {
          submitCell(cell.source, cell.id);
        }
      });
      setExecuteAllCellsFlag(false); // Reset after executing all cells
    }
  }, [kernel.session, notebook, submitCell]);

  useEffect(() => {
    if (executeAllCellsFlag) {
      submitAllCellsForExecution();
    }
  }, [executeAllCellsFlag, submitAllCellsForExecution]);

  const doRestartKernel = () => {
    kernel.restartKernel().catch((error) => console.error('Error restarting kernel:', error));
  };

  const doRestartAndExecuteAllCells = async () => {
    if (!kernel.session) return;

    try {
      // The new kernel has to be connected before any cell is submitted.
      await kernel.restartKernel();
      setExecuteAllCellsFlag(true);
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
   * Every cell's editor, by cell id, for the notebook's own find (story 17).
   *
   * A ref rather than state: a view arriving is not a render, and the find card asks for them only
   * when it searches. Cleared by the cell as it unmounts, so a stale view is never dispatched into.
   */
  const cellViews = useRef<Map<string, EditorView>>(new Map());
  const [viewsVersion, setViewsVersion] = useState(0);
  const registerCellView = useCallback((cellId: string, view: EditorView | null) => {
    if (view === null) {
      cellViews.current.delete(cellId);
    } else {
      cellViews.current.set(cellId, view);
      setViewsVersion((count) => count + 1);
    }
  }, []);

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
    divRefs: cells.divRefs,
    active: finding,
    viewsVersion,
  });
  const openFind = useCallback(() => {
    setFindTakesFocus(true);
    setFinding(true);
    setFindFocus((count) => count + 1);
  }, []);

  /**
   * The table of contents beside the cells — story 22.
   *
   * It lives as long as the tab does, and opens as Settings says: what should remember it *per
   * notebook* is the one thing that story left open, so nothing here writes it anywhere.
   */
  const [editorSettings] = useEditorSettings();
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

  // A project replace carries out its edits here while the notebook is open: through a cell's editor,
  // so its undo takes them back, or into the source of a rendered markdown cell, which has none.
  const notebookRef = useRef(notebook);
  notebookRef.current = notebook;
  const { updateCellSource } = cells;
  const openDoc = useMemo<OpenDocument | null>(
    () =>
      cells.loading || cells.error !== ''
        ? null
        : {
            applyEdits: (edits) => {
              let applied = 0;
              let stale = 0;
              const byCell = new Map<number, LineEdit[]>();
              edits.forEach((edit) => {
                if (edit.cell === undefined) {
                  stale += 1;
                  return;
                }
                byCell.set(edit.cell, [...(byCell.get(edit.cell) ?? []), edit]);
              });
              byCell.forEach((cellEdits, index) => {
                const cell = notebookRef.current.cells[index];
                if (cell === undefined) {
                  stale += cellEdits.length;
                  return;
                }
                const view = cellViews.current.get(cell.id);
                if (view !== undefined) {
                  const outcome = lineEditChanges(view.state.doc, cellEdits);
                  if (outcome.changes.length > 0) {
                    view.dispatch({ changes: outcome.changes });
                  }
                  applied += outcome.changes.length;
                  stale += outcome.stale;
                  return;
                }
                const outcome = editedText(cell.source, cellEdits);
                if (outcome.applied > 0) {
                  updateCellSource(outcome.text, cell.id);
                }
                applied += outcome.applied;
                stale += outcome.stale;
              });
              return { applied, stale };
            },
          },
    [cells.loading, cells.error, updateCellSource]
  );
  useOpenDocument(data.path, openDoc);

  /**
   * A match pressed in the search panel: the notebook's card searching for the same thing, and that match
   * the current one. In two steps, because the card's matches only exist once its query has been set.
   */
  const reveal = useAtomValue(revealMatchAtom);
  const setReveal = useSetAtom(revealMatchAtom);
  const pendingReveal = useRef<MatchReveal | null>(null);
  const setFindOptions = useRef(find.setOptions);
  setFindOptions.current = find.setOptions;
  const findOptions = useRef(find.options);
  findOptions.current = find.options;
  useEffect(() => {
    if (reveal === null || reveal.path !== data.path || cells.loading) {
      return;
    }
    setReveal(null);
    pendingReveal.current = reveal;
    const asked = findOptions.current;
    // Set only when different: an unchanged search set again is a new query, whose reset would take away
    // the current match a moment after the step below has made it.
    if (
      asked.search !== reveal.search ||
      asked.caseSensitive !== reveal.caseSensitive ||
      asked.wholeWord !== reveal.wholeWord ||
      asked.regexp !== reveal.regexp ||
      !asked.outputs
    ) {
      setFindOptions.current({
        search: reveal.search,
        caseSensitive: reveal.caseSensitive,
        wholeWord: reveal.wholeWord,
        regexp: reveal.regexp,
        outputs: true,
      });
    }
    setFindTakesFocus(false);
    setFinding(true);
  }, [reveal, data.path, cells.loading, setReveal]);

  const { focusCell, scrollTo } = cells;
  useEffect(() => {
    const wanted = pendingReveal.current;
    const asked = find.options;
    // After the card is open, for the same reason: opening it resets the current match too.
    if (
      wanted === null ||
      !finding ||
      asked.search !== wanted.search ||
      asked.caseSensitive !== wanted.caseSensitive ||
      asked.wholeWord !== wanted.wholeWord ||
      asked.regexp !== wanted.regexp
    ) {
      return;
    }
    const index = wanted.cell ?? -1;
    const cell = notebook.cells[index];
    if (cell === undefined) {
      pendingReveal.current = null;
      return;
    }
    // A cell's editor arrives a render after the cell does. A markdown cell showing its prose never has
    // one, and is the only cell not worth waiting for.
    const rendered = cell.cell_type === 'markdown' && cells.editingCellId !== cell.id;
    if (!rendered && wanted.output !== true && !cellViews.current.has(cell.id)) {
      return;
    }
    pendingReveal.current = null;
    const text = wanted.output === true ? outputText(cell) : cell.source;
    const doc = Text.of(text.split('\n'));
    const from = doc.line(Math.min(wanted.line, doc.lines)).from + wanted.from;
    const where = wanted.output === true ? 'output' : 'source';
    const found = find.matches.findIndex(
      (match) => match.cellId === cell.id && match.where === where && match.from === from
    );
    if (found >= 0) {
      find.goTo(found);
      return;
    }
    // Not among the card's matches — a rendered markdown cell, which the card does not search — so the
    // cell itself is where the reader is taken.
    focusCell(cell.id);
    scrollTo(index);
  }, [find, finding, notebook.cells, focusCell, scrollTo, cells.editingCellId, viewsVersion]);

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

  // Only HTML asks anything before it writes: story 21 settled on a dialog (option D) for the two
  // things a page can leave out, and Markdown and the script have no equivalent question.
  const [askingExport, setAskingExport] = useState(false);

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

  // Only while this is the visible tab: every open notebook stays mounted, so registering
  // unconditionally is what used to let Ctrl-B add a cell to all of them at once.
  useRegisterCommands(commands, data.active);
  const runCommand = useRunCommand();

  // Chords CodeMirror would otherwise consume, handed to the cells' editors directly rather than
  // through the registry, so a cell can only run its own notebook's commands.
  const commandKeymap = useEditorCommandKeymap(commands);

  const cellContext: NotebookEditorContextValue = {
    run: runCommand,
    commandKeymap,
    cellLanguage,
    findExtension,
    registerCellView,
    focusedIndex: cells.focusedIndex,
    focusCell: cells.focusCell,
    focusCellBox: cells.focusCellBox,
    focusNextCell: cells.focusNextCell,
    focusPreviousCell: cells.focusPreviousCell,
    divRefs: cells.divRefs,
    updateCellSource: cells.updateCellSource,
    addCellAt: cells.addCellAt,
    submitCell,
    interruptKernel: kernel.interruptKernel,
    beginEditing: cells.beginEditing,
    endEditing: cells.endEditing,
    showPrompt: kernel.showPrompt,
    promptContent: kernel.promptContent,
    promptCellId: kernel.promptCellId,
    submitPrompt,
    toggleShowPrompt: kernel.toggleShowPrompt,
    requestCompletions: kernel.requestCompletions,
    widgets: kernel.widgets,
  };

  return (
    <div className="tab-surface">
      <div
        className={data.active ? 'editor-pane' : 'editor-pane is-hidden'}
        id="profile"
        role="tabpanel"
        aria-labelledby="profile-tab"
      >
        <BreadCrumb path={data.path} />
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
                // The band, at the top of the pane, rather than the bordered box in the middle of it this
                // used to be. No `.z-notice-action`: the answer to an unreadable notebook is to open it as
                // text, and nothing in the app can do that yet — a band with a button that does nothing is
                // worse than a band without one.
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
                  cells.setFocusedIndex(index);
                  cells.scrollTo(index, 'start');
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
