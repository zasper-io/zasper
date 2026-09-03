import { useCallback, useEffect, useRef, useState } from 'react';
import 'react-toastify/dist/ReactToastify.css';
import './NotebookEditor.scss';

import { logApiError, saveNotebook } from '@/api';
import { IfileTab } from '@/store/TabState';
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
import { useKernelSession } from './useKernelSession';
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
  const { startTabSession } = kernel;

  useEffect(() => {
    if (data.load_required === true) {
      loadNotebook(data.path);
      startTabSession(data.kernelspec);
    }
  }, [data, loadNotebook, startTabSession]);

  const saveNotebookToDisk = () => {
    const metadata: INotebookMetadata = {
      kernelspec: kernel.kernelName,
      name: kernel.kernelName,
      display_name: kernel.kernelName,
    };
    notebook.metadata = metadata;

    saveNotebook(data.path, notebook).catch(logApiError('Error saving notebook:'));

    return true;
  };

  const submitCell = useCallback(
    (source: string, cellId: string) => {
      cells.markCellRunning(cellId);
      kernel.sendExecuteRequest(source, cellId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cells.markCellRunning, kernel.sendExecuteRequest]
  );

  const submitPrompt = (cellId: string, parentHeader: IKernelMessage, inputValue: string) => {
    cells.clearCellOutputs(cellId);
    kernel.sendInputReply(cellId, parentHeader, inputValue);
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
    saveNotebook: saveNotebookToDisk,
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
            submitPrompt={submitPrompt}
            toggleShowPrompt={kernel.toggleShowPrompt}
            requestCompletions={kernel.requestCompletions}
            connection={kernel.connection}
          />
        </div>
      </div>
    </div>
  );
}
