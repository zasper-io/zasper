import { useCallback, useEffect, useRef, useState } from 'react';
import 'react-toastify/dist/ReactToastify.css';
import './NotebookEditor.scss';

import { logApiError, saveNotebook } from '@/api';
import { IfileTab } from '@/store/TabState';
import { useUnsavedChanges } from '@/store/UnsavedState';
import BreadCrumb from '../BreadCrumb';
import { CodeMirrorRef } from './Cell';
import ErrorDialog from './ErrorDialog';
import { IKernelMessage } from './kernelMessages';
import KernelSwitcher from './KernelSwitch';
import NbButtons from './NbButtons';
import NotebookCells from './NotebookCells';
import { INotebookMetadata } from '@/api';

import { useRegisterCommands, useRunCommand } from '@/commands/registry';
import { useEditorCommandKeymap } from '@/commands/useEditorCommandKeymap';
import { useNotebookCommands } from './notebookCommands';
import { NO_KERNEL, useKernelSession } from './useKernelSession';
import { useNotebookCells } from './useNotebookCells';

interface NotebookEditorProps {
  data: IfileTab;
}

export default function NotebookEditor({ data }: NotebookEditorProps) {
  const codeMirrorRefs = useRef<CodeMirrorRef[] | null>([]);
  const [executeAllCellsFlag, setExecuteAllCellsFlag] = useState<boolean>(false);

  const cells = useNotebookCells();
  const kernel = useKernelSession(data, cells.applyMessage);

  const { loadNotebook, notebook } = cells;
  const { startSessionForNotebook } = kernel;

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
    const metadata: INotebookMetadata = { ...notebook.metadata };
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

  const submitCell = useCallback(
    (source: string, cellId: string) => {
      cells.markCellRunning(cellId);
      kernel.sendExecuteRequest(source, cellId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cells.markCellRunning, kernel.sendExecuteRequest]
  );

  const submitPrompt = (parentHeader: IKernelMessage, inputValue: string) => {
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

  const restartKernel = () => {
    kernel.restartKernel().catch((error) => console.error('Error restarting kernel:', error));
  };

  const restartAndExecuteAllCells = async () => {
    if (!kernel.session) return;

    try {
      // The new kernel has to be connected before any cell is submitted.
      await kernel.restartKernel();
      setExecuteAllCellsFlag(true);
    } catch (error) {
      console.error('Error restarting kernel:', error);
    }
  };

  // Every action this notebook offers, in one list — this is what the toolbars dispatch, what the
  // palette lists and what the keyboard resolves. It replaced a `keydown` handler here, another in
  // useNotebookCells, and a keymap in Cell, which between them disagreed about Shift-Enter and made
  // a capital M untypable.
  const commands = useNotebookCommands({
    cells,
    kernel,
    // A keystroke has nowhere to report a failed save, so it goes to the console; the close prompt
    // awaits the same promise and shows the reason instead.
    saveNotebook: () => {
      saveNotebookToDisk().catch(logApiError('Error saving notebook:'));
    },
    submitCell,
    submitAllCells: submitAllCellsForExecution,
    restartKernel,
    restartAndExecuteAllCells,
  });

  // Only while this is the visible tab: every open notebook stays mounted, so registering
  // unconditionally is what used to let Ctrl-B add a cell to all of them at once.
  useRegisterCommands(commands, data.active);
  const runCommand = useRunCommand();

  // Chords CodeMirror would otherwise consume, handed to the cells' editors directly rather than
  // through the registry, so a cell can only run its own notebook's commands.
  const commandKeymap = useEditorCommandKeymap(commands);

  return (
    <div className="tab-content">
      <div
        className={data.active ? 'editor-pane' : 'editor-pane is-hidden'}
        id="profile"
        role="tabpanel"
        aria-labelledby="profile-tab"
      >
        <BreadCrumb path={data.path} />
        <NbButtons
          run={runCommand}
          cellType={notebook.cells[cells.focusedIndex]?.cell_type ?? ''}
          kernelName={kernel.kernelName}
          kernelStatus={kernel.kernelStatus}
        />

        <div className="editor-body">
          {kernel.showKernelSwitcher && (
            <KernelSwitcher
              kernelName={kernel.kernelName}
              toggleKernelSwitcher={kernel.toggleKernelSwitcher}
              changeKernel={kernel.changeKernel}
            />
          )}
          {kernel.showErrorDialog && <ErrorDialog toggleErrorDialog={kernel.toggleErrorDialog} />}

          {/* The cells are not offered for editing once a read failed: they would be the empty
              starting state rather than the file. */}
          {cells.error !== '' ? (
            <div className="notebookLoadError" role="alert">
              <strong>This notebook could not be loaded.</strong>
              <p>{cells.error}</p>
            </div>
          ) : (
            <NotebookCells
              notebook={notebook}
              focusedIndex={cells.focusedIndex}
              setFocusedIndex={cells.setFocusedIndex}
              divRefs={cells.divRefs}
              codeMirrorRefs={codeMirrorRefs}
              run={runCommand}
              commandKeymap={commandKeymap}
              focusNextCell={cells.focusNextCell}
              focusPreviousCell={cells.focusPreviousCell}
              updateCellSource={cells.updateCellSource}
              showPrompt={kernel.showPrompt}
              promptContent={kernel.promptContent}
              promptCellId={kernel.promptCellId}
              submitPrompt={submitPrompt}
              toggleShowPrompt={kernel.toggleShowPrompt}
              requestCompletions={kernel.requestCompletions}
              widgets={kernel.widgets}
            />
          )}
        </div>
      </div>
    </div>
  );
}
