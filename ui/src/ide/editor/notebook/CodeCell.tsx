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
import { countRows, DATAFRAMES } from '@/api';
import { connectionsAtom } from '@/store/connections';
import { parseSqlCell, withRunFlags, withSqlOptions } from './sqlCell';
import { sqlCellExtensions } from './sqlEditor';
import SqlCellHead from './SqlCellHead';
import CellTime from './CellTime';
import { useSqlSchema } from './useSqlSchema';
import { zoomAwareTooltips } from '../tooltipParent';

/** The name a cell's last line is when it is nothing else: what a chart's code can be written against. */
function printedName(source: string): string | null {
  const last = source.trimEnd().split('\n').pop()?.trim() ?? '';
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(last) ? last : null;
}

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
    cellLanguageName,
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

  // A SQL cell: a code cell whose first line is the %%zasper_sql magic, which the editor hides and the
  // head above it shows as controls. Its language is SQL, completed from the connection's schema.
  const sqlCell = cell.cell_type === 'code' ? parseSqlCell(cell.source) : null;
  const connections = useAtomValue(connectionsAtom);
  const connectionType =
    sqlCell === null
      ? ''
      : sqlCell.connection === DATAFRAMES
        ? DATAFRAMES
        : (connections?.connections.find((c) => c.name === sqlCell.connection)?.type ?? '');
  const { namespace, defaultSchema } = useSqlSchema(sqlCell?.connection ?? '', editor.kernelId);
  const isSql = sqlCell !== null;
  const sqlLanguage = useMemo(
    () => (isSql ? sqlCellExtensions(connectionType, namespace, defaultSchema) : null),
    [isSql, connectionType, namespace, defaultSchema]
  );

  // Memoized for the reason CELL_SETUP gives.
  const extensions = useMemo(
    () => [
      // A SQL cell's completion is the schema's, not the Python language server's or the kernel's.
      ...(sqlLanguage !== null ? [sqlLanguage] : [cellLanguage, intelligence]),
      popupPlacement,
      Prec.highest(keymap.of(cellTabIndents ? tabIndentKeymap : tabCompletionKeymap)),
      leaveCell,
      findExtension,
      commandKeymap,
    ],
    [
      sqlLanguage,
      cellLanguage,
      intelligence,
      popupPlacement,
      cellTabIndents,
      leaveCell,
      findExtension,
      commandKeymap,
    ]
  );

  // A submitted cell holds -1 until the kernel's execute_input gives it its count.
  const queued = props.isRunning && cell.execution_count === -1;
  const running = props.isRunning && !queued;
  const gutterClass = running
    ? 'cell-gutter is-running'
    : queued
      ? 'cell-gutter is-queued'
      : 'cell-gutter';

  return (
    <div {...box}>
      <CellButtons run={editor.run} cellType={cell.cell_type} />

      <div className="inner-content">
        {/* The run button and the count, both always shown. While the kernel is on this cell the
            button is the stop and the count a spinner; a cell waiting behind it says `[*]`. A raw
            cell is neither run nor rendered, as in Jupyter, so its gutter stays empty. */}
        <div className={gutterClass}>
          {cell.cell_type === 'code' && (
            <IconButton
              icon={running ? 'square' : 'play'}
              className="cell-run"
              label={running ? 'Interrupt Kernel' : queued ? 'Queued' : 'Run Cell'}
              name={running ? 'Interrupt Kernel' : `Run cell ${props.index + 1}`}
              disabled={queued}
              onClick={() =>
                running ? editor.interruptKernel() : editor.submitCell(cell.source, cellId)
              }
            />
          )}
          <span className="serial-no">
            {running ? (
              // Named, because which cell the kernel is on is the one thing in this gutter a screen
              // reader has to be told.
              <span className="z-spinner" role="status" aria-label="Running" />
            ) : (
              cell.cell_type === 'code' && `[${queued ? '*' : (cell.execution_count ?? ' ')}]:`
            )}
          </span>
        </div>
        {/* The cell's kind is set in its box's top border: the kernel's language, `raw` or `sql`. A
            SQL cell's head is the box's first line, so the box is drawn here rather than by the
            editor inside it. */}
        <div
          className={sqlCell === null ? 'cellEditor' : 'cellEditor has-head'}
          data-kind={sqlCell !== null ? 'sql' : cell.cell_type === 'raw' ? 'raw' : cellLanguageName}
        >
          {sqlCell !== null && (
            <SqlCellHead
              cell={sqlCell}
              onChange={(changes) => updateCellSource(withSqlOptions(cell.source, changes), cellId)}
            />
          )}
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
          {cell.cell_type === 'code' && (
            <CellTime timing={props.timing} isRunning={props.isRunning} />
          )}
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
          <CellOutput
            data={cell}
            widgets={editor.widgets}
            tables={{
              kernelId: editor.kernelId,
              notebookPath: editor.notebookPath,
              executionCount: cell.execution_count,
              variable: printedName(cell.source),
              insertBelow: (source) => editor.insertCodeAfter(cell.id, source),
            }}
            sql={
              sqlCell === null
                ? undefined
                : {
                    run: (flags) => editor.submitCell(withRunFlags(cell.source, flags), cellId),
                    count:
                      editor.kernelId === undefined
                        ? undefined
                        : () => countRows(editor.kernelId ?? '', sqlCell.connection, sqlCell.query),
                    kernelId: editor.kernelId,
                  }
            }
          />
        </div>
      )}
    </div>
  );
}
