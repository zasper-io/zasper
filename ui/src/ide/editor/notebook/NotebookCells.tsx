import React from 'react';
import { type Extension } from '@codemirror/state';

import Cell, { CodeMirrorRef } from './Cell';
import CellInsert from './CellInsert';
import { ICompleteReply, IKernelMessage } from './kernelMessages';
import { ICell, INotebookModel } from '@/api';
import type { WidgetBridge } from '@/ide/widgets/widgetBridge';

interface NotebookCellsProps {
  notebook: INotebookModel;
  focusedIndex: number;
  focusCell: (cellId: string) => void;
  divRefs: React.RefObject<(HTMLDivElement | null)[]>;
  codeMirrorRefs: React.RefObject<CodeMirrorRef[] | null>;
  run: (id: string) => void;
  commandKeymap: Extension;
  focusNextCell: (addCellIfLast: boolean) => void;
  focusPreviousCell: () => void;
  updateCellSource: (value: string, cellId: string) => void;
  /** Puts a cell where the pointer is, for the rail between two cells. */
  addCellAt: (index: number, cellType: ICell['cell_type']) => void;
  /** Runs one named cell, for the button in its gutter. See `submitCell` in Cell.tsx. */
  submitCell: (source: string, cellId: string) => void;
  interruptKernel: () => void;
  /** The cells the kernel is currently running, so each can show a spinner for as long as it is. */
  runningCellIds: ReadonlySet<string>;
  /** The cells whose output has been let past its height cap. */
  expandedOutputs: ReadonlySet<string>;
  /** The markdown cell whose source is open, if any. */
  editingCellId: string | null;
  beginEditing: (cellId: string) => void;
  endEditing: () => void;
  showPrompt: Boolean;
  promptContent: IKernelMessage;
  /** Which cell the kernel is asking input for, so only that cell shows the prompt. */
  promptCellId: string | undefined;
  submitPrompt: (parentHeader: IKernelMessage, inputValue: string) => void;
  toggleShowPrompt: () => void;
  requestCompletions: (source: string, cursorPos: number) => Promise<ICompleteReply | null>;
  widgets: WidgetBridge | null;
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
        <React.Fragment key={cell.id}>
          {/* Above every cell, so the first one can be inserted before too. The rail eats the gap
              the cell above already leaves, so at rest the notebook is laid out as it was. */}
          <CellInsert index={index} addCellAt={props.addCellAt} />
          <Cell
            key={cell.id}
            index={index}
            cell={cell}
            execution_count={cell.execution_count}
            run={props.run}
            commandKeymap={props.commandKeymap}
            focusNextCell={props.focusNextCell}
            focusPreviousCell={props.focusPreviousCell}
            focusedIndex={props.focusedIndex}
            focusCell={props.focusCell}
            divRefs={props.divRefs}
            codeMirrorRefs={props.codeMirrorRefs}
            updateCellSource={props.updateCellSource}
            isRunning={props.runningCellIds.has(cell.id)}
            isOutputExpanded={props.expandedOutputs.has(cell.id)}
            isEditing={props.editingCellId === cell.id}
            beginEditing={props.beginEditing}
            endEditing={props.endEditing}
            showPrompt={props.showPrompt}
            promptContent={props.promptContent}
            promptCellId={props.promptCellId}
            submitPrompt={props.submitPrompt}
            toggleShowPrompt={props.toggleShowPrompt}
            requestCompletions={props.requestCompletions}
            widgets={props.widgets}
            submitCell={props.submitCell}
            interruptKernel={props.interruptKernel}
          />
        </React.Fragment>
      ))}
      <CellInsert index={notebook.cells.length} addCellAt={props.addCellAt} isEnd />
    </>
  );
}
