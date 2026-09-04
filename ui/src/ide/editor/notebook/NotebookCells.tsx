import React from 'react';
import { type Extension } from '@codemirror/state';

import Cell, { CodeMirrorRef } from './Cell';
import { ICompleteReply, IKernelMessage } from './kernelMessages';
import { INotebookModel } from '@/api';
import type { WidgetBridge } from '@/ide/widgets/widgetBridge';

interface NotebookCellsProps {
  notebook: INotebookModel;
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  divRefs: React.RefObject<(HTMLDivElement | null)[]>;
  codeMirrorRefs: React.RefObject<CodeMirrorRef[] | null>;
  run: (id: string) => void;
  commandKeymap: Extension;
  focusNextCell: (addCellIfLast: boolean) => void;
  focusPreviousCell: () => void;
  updateCellSource: (value: string, cellId: string) => void;
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
          setFocusedIndex={props.setFocusedIndex}
          divRefs={props.divRefs}
          codeMirrorRefs={props.codeMirrorRefs}
          updateCellSource={props.updateCellSource}
          showPrompt={props.showPrompt}
          promptContent={props.promptContent}
          promptCellId={props.promptCellId}
          submitPrompt={props.submitPrompt}
          toggleShowPrompt={props.toggleShowPrompt}
          requestCompletions={props.requestCompletions}
          widgets={props.widgets}
        />
      ))}
    </>
  );
}
