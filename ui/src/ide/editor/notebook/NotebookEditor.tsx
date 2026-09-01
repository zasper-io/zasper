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

import { INotebookKeyEvent } from './types';
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

  // cellId is unused: the inspect request carries only the code and cursor position,
  // but the cell passes its id first, so the parameter is kept for call-site parity.
  const submitTabCompletion = (cellId: string, source: string, cursorPos: number) => {
    kernel.sendInspectRequest(source, cursorPos);
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

  const handleKeyDown = (addCell: boolean, event: INotebookKeyEvent) => {
    const focusedCell = notebook.cells[cells.focusedIndex];

    if (event.key === 'ArrowDown') {
      cells.focusNextCell(addCell);
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      cells.focusPreviousCell();
      event.preventDefault();
    }

    // Handle deleting a cell (D, D for delete)
    if (event.key === 'd' && event.ctrlKey && event.shiftKey) {
      cells.deleteCell(); // Ctrl + Shift + D -> Delete cell
      event.preventDefault();
    }

    // Handle running a cell with Ctrl + Enter (no move) or Shift + Enter (move to next)
    if (event.key === 'Enter') {
      if (event.ctrlKey) {
        submitCell(focusedCell.source, focusedCell.id); // Ctrl + Enter -> Run cell
      } else if (event.shiftKey) {
        submitCell(focusedCell.source, focusedCell.id); // Shift + Enter -> Run and move to next
        cells.goToNextCell(); // Move to next cell after running
      }
      event.preventDefault();
    }

    // Handle cell type change (Y for code, M for markdown)
    if (event.key === 'y' && event.ctrlKey) {
      cells.changeCellType('code'); // Ctrl + Y -> Change cell to code
      event.preventDefault();
    } else if (event.key === 'm' && event.ctrlKey) {
      cells.changeCellType('markdown'); // Ctrl + M -> Change cell to markdown
      event.preventDefault();
    }

    // Handle saving the notebook with Cmd/Ctrl + S
    if ((event.key === 's' && event.ctrlKey) || (event.key === 's' && event.metaKey)) {
      saveNotebookToDisk(); // Ctrl + S (or Cmd + S) -> Save notebook
      event.preventDefault();
    }

    // Handle undo (Ctrl + Z)
    if (event.key === 'z' && event.ctrlKey) {
      console.log('Undo action'); // Add undo logic here if necessary
      event.preventDefault();
    }
  };

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
          saveNotebook={saveNotebookToDisk}
          addCellDown={cells.addCellDown}
          cutCell={cells.cutCell}
          copyCell={cells.copyCell}
          pasteCell={cells.pasteCell}
          submitCell={submitCell}
          interruptKernel={kernel.interruptKernel}
          restartKernel={restartKernel}
          restartAndExecuteAllCells={restartAndExecuteAllCells}
          focusedIndex={cells.focusedIndex}
          notebook={notebook}
          kernelName={kernel.kernelName}
          kernelStatus={kernel.kernelStatus}
          changeCellType={cells.changeCellType}
          reconnectKernel={kernel.reconnectKernel}
          toggleKernelSwitcher={kernel.toggleKernelSwitcher}
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
            submitCell={submitCell}
            copyCellByIndex={cells.copyCellByIndex}
            addCellUp={cells.addCellUp}
            addCellDown={cells.addCellDown}
            prevCell={cells.goToPreviousCell}
            nextCell={cells.goToNextCell}
            deleteCell={cells.deleteCell}
            handleKeyDown={handleKeyDown}
            changeCellType={cells.changeCellType}
            updateCellSource={cells.updateCellSource}
            showPrompt={kernel.showPrompt}
            promptContent={kernel.promptContent}
            submitPrompt={submitPrompt}
            toggleShowPrompt={kernel.toggleShowPrompt}
            submitTabCompletion={submitTabCompletion}
            inspectReplyMessage={kernel.inspectReplyMessage}
            connection={kernel.connection}
          />
        </div>
      </div>
    </div>
  );
}
