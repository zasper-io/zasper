import React, { useState, useCallback, lazy, Suspense } from 'react';
import CodeMirror, { Prec } from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { keymap, ViewUpdate } from '@codemirror/view';
import { languages } from '@codemirror/language-data';

import { ICell } from '@/api';
import { useTheme } from '@/themes/useTheme';
import CellButtons from './CellButtons';
import CellOutput from './CellOutput';
import LoaderSvg from './LoaderSvg';
import Prompt from './Prompt';
import { IKernelMessage } from './kernelMessages';
import { IKernelConnection, INotebookKeyEvent } from './types';

// react-markdown + remark-math + rehype-katex is the heaviest thing in the
// notebook and nothing needs it until a markdown cell is actually rendered, so
// it loads on demand. See MarkdownRenderer.tsx.
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

interface ICellProps {
  cell: ICell;
  index: number;
  submitCell: (source: string, cellId: string) => void;
  addCellUp: () => void;
  addCellDown: () => void;
  copyCellByIndex: (index: number) => void;
  prevCell: () => void;
  nextCell: () => void;
  deleteCell: (index: number) => void;
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  handleKeyDown: (addCell: boolean, event: INotebookKeyEvent) => void;
  changeCellType: (value: string) => void;
  divRefs: React.RefObject<(HTMLDivElement | null)[]>;
  execution_count: number;
  codeMirrorRefs: React.RefObject<CodeMirrorRef[] | null>;
  updateCellSource: (value: string, cellId: string) => void;
  showPrompt: Boolean;
  promptContent: IKernelMessage;
  submitPrompt: (cellId: string, parentHeader: IKernelMessage, inputValue: string) => void;
  toggleShowPrompt: () => void;
  inspectReplyMessage: string;
  submitTabCompletion: (cellId: string, source: string, cursor_pos: number) => void;
  connection: IKernelConnection;
}

export interface CodeMirrorRef {
  editor: {
    focus: () => void;
  };
}

const Cell = React.forwardRef((props: ICellProps, ref) => {
  const { cell, updateCellSource } = props;
  const theme = useTheme();
  const [cellContents, setCellContents] = useState(cell.source);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [totalLines, setTotalLines] = useState(0);

  const onChange = useCallback(
    (value: string) => {
      setCellContents(value);
      updateCellSource(value, cell.id);
    },
    [cell, updateCellSource]
  );

  const onUpdate = useCallback((viewUpdate: ViewUpdate) => {
    if (viewUpdate) {
      const { state } = viewUpdate;
      const cursor = state.selection.main.from;
      const line = state.doc.lineAt(cursor).number;

      const totalLines = state.doc.lines;
      setCursorPosition(line);
      setTotalLines(totalLines);
    }
    // props.setFocusedIndex(props.index)
  }, []);

  const handleKeyDownCM = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' && cursorPosition === totalLines) {
      props.handleKeyDown(false, { key: 'ArrowDown', preventDefault: () => {} });
      event.preventDefault();
    } else if (event.key === 'ArrowUp' && cursorPosition === 1) {
      props.handleKeyDown(false, { key: 'ArrowUp', preventDefault: () => {} });
      event.preventDefault();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      props.submitTabCompletion(cell.id, 'abs', cursorPosition);
      event.preventDefault();
    }
  };

  const handleCmdEnter = () => {
    if (props.cell.cell_type === 'code') {
      props.submitCell(cellContents, props.cell.id);
    }
    props.handleKeyDown(true, { key: 'ArrowDown', preventDefault: () => {} });
    return true;
  };

  const handleChangeCellType = () => {
    if (props.cell.cell_type === 'code') {
      props.changeCellType('markdown');
    }
    if (props.cell.cell_type === 'markdown') {
      props.changeCellType('raw');
    }
    if (props.cell.cell_type === 'raw') {
      props.changeCellType('code');
    }
    return true;
  };

  const customKeymap = keymap.of([
    {
      key: 'Shift-Enter',
      run: handleCmdEnter,
    },
    {
      key: 'Shift-M',
      run: handleChangeCellType,
    },
  ]);

  // Make sure divRefs.current is not null before assigning
  const divRef = (el: HTMLDivElement | null) => {
    if (props.divRefs.current) {
      props.divRefs.current[props.index] = el;
    }
  };

  if (cell.cell_type === 'markdown') {
    return (
      <div
        tabIndex={props.index}
        className={props.index === props.focusedIndex ? 'single-line activeCell' : 'single-line'}
        ref={divRef}
        onFocus={() => props.setFocusedIndex(props.index)}
      >
        {props.index === props.focusedIndex ? (
          <>
            <CellButtons
              index={props.index}
              cellId={cell.id}
              code={cellContents}
              addCellUp={props.addCellUp}
              addCellDown={props.addCellDown}
              submitCell={props.submitCell}
              copyCellByIndex={props.copyCellByIndex}
              deleteCell={props.deleteCell}
              nextCell={props.nextCell}
              prevCell={props.prevCell}
            />
            <div className="inner-content">
              <div className="cellEditor">
                <CodeMirror
                  theme={theme.codeMirror}
                  value={cellContents}
                  height="auto"
                  width="100%"
                  extensions={[
                    markdown({ base: markdownLanguage, codeLanguages: languages }),
                    [Prec.highest(customKeymap)],
                  ]}
                  autoFocus={props.index === props.focusedIndex ? true : false}
                  onChange={onChange}
                  onUpdate={onUpdate}
                  onKeyDown={handleKeyDownCM}
                  basicSetup={{
                    lineNumbers: false,
                    bracketMatching: true,
                    highlightActiveLineGutter: true,
                    autocompletion: true,
                    lintKeymap: true,
                    foldGutter: true,
                    completionKeymap: true,
                    tabSize: 4,
                  }}
                />
              </div>
            </div>
          </>
        ) : (
          <Suspense fallback={<pre>{cellContents}</pre>}>
            <MarkdownRenderer source={cellContents} />
          </Suspense>
        )}
      </div>
    );
  }

  return (
    <div
      tabIndex={props.index}
      className={props.index === props.focusedIndex ? 'single-line activeCell' : 'single-line'}
      ref={divRef}
      onFocus={() => props.setFocusedIndex(props.index)}
    >
      {props.index === props.focusedIndex ? (
        <CellButtons
          index={props.index}
          code={cellContents}
          cellId={cell.id}
          submitCell={props.submitCell}
          addCellUp={props.addCellUp}
          addCellDown={props.addCellDown}
          copyCellByIndex={props.copyCellByIndex}
          deleteCell={props.deleteCell}
          nextCell={props.nextCell}
          prevCell={props.prevCell}
        />
      ) : (
        <></>
      )}

      <div className="inner-content">
        {props.execution_count === -1 ? (
          <LoaderSvg />
        ) : (
          <div className="serial-no">[{props.execution_count}]:</div>
        )}
        <div className="cellEditor">
          <CodeMirror
            theme={theme.codeMirror}
            value={cellContents}
            height="auto"
            width="100%"
            extensions={[python(), [Prec.highest(customKeymap)]]}
            autoFocus={props.index === props.focusedIndex ? true : false}
            onChange={onChange}
            onUpdate={onUpdate}
            onKeyDown={handleKeyDownCM}
            basicSetup={{
              lineNumbers: false,
              bracketMatching: true,
              highlightActiveLineGutter: true,
              autocompletion: true,
              lintKeymap: true,
              foldGutter: true,
              completionKeymap: true,
              tabSize: 4,
            }}
          />
        </div>
      </div>
      {props.showPrompt &&
        props.promptContent &&
        props.promptContent.content &&
        props.promptContent.parent_header.msg_id === props.cell.id && (
          <Prompt
            content={props.promptContent}
            submitPrompt={props.submitPrompt}
            toggleShowPrompt={props.toggleShowPrompt}
          />
        )}
      <div className="inner-text">
        <CellOutput data={cell} connection={props.connection} />
      </div>
    </div>
  );
});

export default Cell;
