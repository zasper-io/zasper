import React from 'react';

import Cell, { CodeMirrorRef } from './Cell';
import { IKernelMessage } from './kernelMessages';
import { IKernelConnection, INotebookKeyEvent, INotebookModel } from './types';

interface NotebookCellsProps {
  notebook: INotebookModel;
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  divRefs: React.RefObject<(HTMLDivElement | null)[]>;
  codeMirrorRefs: React.RefObject<CodeMirrorRef[] | null>;
  submitCell: (source: string, cellId: string) => void;
  copyCellByIndex: (index: number) => void;
  addCellUp: () => void;
  addCellDown: () => void;
  prevCell: () => void;
  nextCell: () => void;
  deleteCell: () => void;
  handleKeyDown: (addCell: boolean, event: INotebookKeyEvent) => void;
  changeCellType: (value: string) => void;
  updateCellSource: (value: string, cellId: string) => void;
  showPrompt: Boolean;
  promptContent: IKernelMessage;
  submitPrompt: (cellId: string, parentHeader: IKernelMessage, inputValue: string) => void;
  toggleShowPrompt: () => void;
  submitTabCompletion: (cellId: string, source: string, cursorPos: number) => void;
  inspectReplyMessage: string;
  connection: IKernelConnection;
}

/** Renders the notebook body: one <Cell> per cell, in document order. */
export default function NotebookCells(props: NotebookCellsProps) {
  const { notebook } = props;

  if (!notebook.cells) {
    return null;
  }

  return (
    <>
      {notebook.cells.map((cell, index) => (
        <Cell
          key={cell.id}
          index={index}
          cell={cell}
          execution_count={cell.execution_count}
          submitCell={props.submitCell}
          copyCellByIndex={props.copyCellByIndex}
          addCellUp={props.addCellUp}
          addCellDown={props.addCellDown}
          prevCell={props.prevCell}
          nextCell={props.nextCell}
          deleteCell={props.deleteCell}
          focusedIndex={props.focusedIndex}
          setFocusedIndex={props.setFocusedIndex}
          handleKeyDown={props.handleKeyDown}
          changeCellType={props.changeCellType}
          divRefs={props.divRefs}
          codeMirrorRefs={props.codeMirrorRefs}
          updateCellSource={props.updateCellSource}
          showPrompt={props.showPrompt}
          promptContent={props.promptContent}
          submitPrompt={props.submitPrompt}
          toggleShowPrompt={props.toggleShowPrompt}
          submitTabCompletion={props.submitTabCompletion}
          inspectReplyMessage={props.inspectReplyMessage}
          connection={props.connection}
        />
      ))}
    </>
  );
}
