import React, { useCallback, useMemo, useState } from 'react';
import CodeMirror, { Prec } from '@uiw/react-codemirror';
import { keymap } from '@codemirror/view';
import { useAtomValue } from 'jotai';

import IconButton from '@/ide/IconButton';
import { editorSettingsAtom } from '@/store/settings';
import { useTheme } from '@/themes/useTheme';
import CellButtons from './CellButtons';
import CellOutput from './CellOutput';
import Prompt from './Prompt';
import { cellIntelligence } from './cellIntelligence';
import {
  CellProps,
  CODE_SETUP,
  tabIndentKeymap,
  useCellBox,
  useCellView,
  useLeaveCellKeymap,
} from './cellShared';
import { tabCompletionKeymap } from './kernelCompletion';
import { useNotebookEditor } from './NotebookEditorContext';
import { zoomAwareTooltips } from '../tooltipParent';

/** A code cell, and a raw one: an editor, its execution count, and its output. */
export default function CodeCell(props: CellProps) {
  const { cell, isFocused } = props;
  const editor = useNotebookEditor();
  const {
    updateCellSource,
    requestCompletions,
    requestInspection,
    kernelIdle,
    languageServer,
    cellLanguage,
    findExtension,
    commandKeymap,
  } = editor;
  const theme = useTheme();
  const cellTabIndents = useAtomValue(editorSettingsAtom).cell_tab_indents;
  const { keepView } = useCellView(cell.id);
  const box = useCellBox(cell.id, isFocused);
  const leaveCell = useLeaveCellKeymap(cell.id, false);
  // Taken once: @uiw/react-codemirror focuses the editor whenever `autoFocus` turns true, not only when
  // it is made, which would pull every cell the focus moves to into edit mode. A cell made focused — one
  // just inserted — is the one that should start with the keyboard.
  const [autoFocus] = useState(isFocused);

  const cellId = cell.id;
  const onChange = useCallback(
    (value: string) => updateCellSource(value, cellId),
    [cellId, updateCellSource]
  );

  const intelligence = useMemo(
    () =>
      cellIntelligence(
        { cellId, server: languageServer, requestCompletions, requestInspection, kernelIdle },
        !cellTabIndents
      ),
    [cellId, languageServer, requestCompletions, requestInspection, kernelIdle, cellTabIndents]
  );

  // See tooltipParent.ts for why a cell has to say where its popup hangs at all: without this it draws
  // at its own coordinate times the zoom.
  const popupPlacement = useMemo(() => zoomAwareTooltips(), []);

  // Memoized for the reason CELL_SETUP gives.
  const extensions = useMemo(
    () => [
      cellLanguage,
      intelligence,
      popupPlacement,
      Prec.highest(keymap.of(cellTabIndents ? tabIndentKeymap : tabCompletionKeymap)),
      leaveCell,
      findExtension,
      commandKeymap,
    ],
    [
      cellLanguage,
      intelligence,
      popupPlacement,
      cellTabIndents,
      leaveCell,
      findExtension,
      commandKeymap,
    ]
  );

  return (
    <div {...box}>
      <CellButtons run={editor.run} cellType={cell.cell_type} />

      <div className="inner-content">
        {/* The count and the button that runs the cell share one 22px box, so the swap between them
            cannot move a pixel of the notebook. At rest the gutter says what it has always said —
            the execution count, or a spinner while the kernel is on this cell — and under the
            pointer it becomes the action, which is beside the code rather than at the far end of
            it. Run used to be the first of eleven icons in a bar at the cell's top-right corner. */}
        <div className={cell.cell_type === 'code' ? 'cell-gutter has-run' : 'cell-gutter'}>
          <span className="serial-no">
            {props.isRunning ? (
              // A spinner rather than `[*]`: the count arrives with `execute_input` a few
              // milliseconds after the cell is submitted, and a cell that went on running for a
              // minute showed a stale `[17]:` and nothing else. Named, because which cell the kernel
              // is on is the one thing in this gutter a screen reader has to be told.
              <span className="z-spinner" role="status" aria-label="Running" />
            ) : (
              // A cell that has not run shows an empty bracket, as Jupyter does. A raw cell never
              // runs, so it has no bracket at all: an empty one says the cell is waiting to run.
              cell.cell_type === 'code' && `[${cell.execution_count ?? ' '}]:`
            )}
          </span>
          {/* A raw cell is neither run nor rendered, as in Jupyter, so its gutter stays a gutter:
              the rule is that the button appears where pressing it would change something. */}
          {cell.cell_type === 'code' && (
            <IconButton
              icon={props.isRunning ? 'square' : 'play'}
              className="cell-run"
              label={props.isRunning ? 'Interrupt Kernel' : 'Run Cell'}
              name={props.isRunning ? 'Interrupt Kernel' : `Run cell ${props.index + 1}`}
              onClick={() =>
                props.isRunning ? editor.interruptKernel() : editor.submitCell(cell.source, cellId)
              }
            />
          )}
        </div>
        <div className="cellEditor">
          <CodeMirror
            theme={theme.codeMirror}
            value={cell.source}
            height="auto"
            width="100%"
            extensions={extensions}
            autoFocus={autoFocus}
            onCreateEditor={keepView}
            onChange={onChange}
            basicSetup={CODE_SETUP}
          />
        </div>
      </div>
      {props.prompt?.content && (
        <Prompt
          content={props.prompt}
          submitPrompt={editor.submitPrompt}
          toggleShowPrompt={editor.toggleShowPrompt}
        />
      )}
      {/* Only when there is something to show — .inner-text has padding and a background,
          so an empty one is a tinted strip under every un-run cell. */}
      {cell.outputs && cell.outputs.length > 0 && (
        <div className={props.isOutputExpanded ? 'inner-text is-expanded' : 'inner-text'}>
          <CellOutput data={cell} widgets={editor.widgets} />
        </div>
      )}
    </div>
  );
}
