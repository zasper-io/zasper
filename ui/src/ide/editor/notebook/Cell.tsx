import React, { useState, useCallback, useMemo, lazy, Suspense } from 'react';
import CodeMirror, { Prec, type Extension } from '@uiw/react-codemirror';
import { autocompletion } from '@codemirror/autocomplete';
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
import { kernelCompletionSource, tabCompletionKeymap } from './kernelCompletion';
import { ICompleteReply, IKernelMessage } from './kernelMessages';
import { IKernelConnection } from './types';

// react-markdown + remark-math + rehype-katex is the heaviest thing in the
// notebook and nothing needs it until a markdown cell is actually rendered, so
// it loads on demand. See MarkdownRenderer.tsx.
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

interface ICellProps {
  cell: ICell;
  index: number;
  /** Dispatches a notebook command by id, for the cell's own toolbar. */
  run: (id: string) => void;
  /**
   * The notebook's `cell-editor` commands as a CodeMirror extension — Ctrl-Enter, Shift-Enter.
   * Passed down rather than read from the command registry so that a cell can only ever run its
   * own notebook's commands.
   */
  commandKeymap: Extension;
  focusNextCell: (addCellIfLast: boolean) => void;
  focusPreviousCell: () => void;
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  divRefs: React.RefObject<(HTMLDivElement | null)[]>;
  /** null until the cell has run, -1 while it is running, and absent on a non-code cell. */
  execution_count: number | null | undefined;
  codeMirrorRefs: React.RefObject<CodeMirrorRef[] | null>;
  updateCellSource: (value: string, cellId: string) => void;
  showPrompt: Boolean;
  promptContent: IKernelMessage;
  promptCellId: string | undefined;
  submitPrompt: (parentHeader: IKernelMessage, inputValue: string) => void;
  toggleShowPrompt: () => void;
  requestCompletions: (source: string, cursorPos: number) => Promise<ICompleteReply | null>;
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

  /**
   * Moving out of the cell at its top or bottom edge. This stays a local handler rather than a
   * command: whether an arrow key leaves the cell depends on where the cursor is inside the
   * document, which is the editor's business and not an action anyone would invoke by name.
   */
  const handleKeyDownCM = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' && cursorPosition === totalLines) {
      props.focusNextCell(false);
      event.preventDefault();
    } else if (event.key === 'ArrowUp' && cursorPosition === 1) {
      props.focusPreviousCell();
      event.preventDefault();
    }
  };

  // Code cells complete against the kernel and nothing else: `override` replaces the language's
  // own sources rather than adding to them, which is what we want — a running kernel knows what
  // `df` is and the parser does not. Hence also `autocompletion: false` in basicSetup below;
  // two autocompletion() instances would fight over one config facet.
  //
  // Memoized because @uiw/react-codemirror reconfigures the editor whenever the extensions it is
  // given change identity, and a cell re-renders on every keystroke — an unmemoized source would
  // replace the completion config out from under a popup as it is being typed into.
  const { requestCompletions } = props;
  const kernelAutocompletion = useMemo(
    () => autocompletion({ override: [kernelCompletionSource(requestCompletions)] }),
    [requestCompletions]
  );

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
            <CellButtons run={props.run} />
            <div className="inner-content">
              {/* A markdown cell has no execution count, but it still needs the gutter a
                  code cell's `[n]:` occupies, or the two cell types sit on different
                  left edges. */}
              <div className="cell-gutter" aria-hidden="true" />
              <div className="cellEditor">
                <CodeMirror
                  theme={theme.codeMirror}
                  value={cellContents}
                  height="auto"
                  width="100%"
                  extensions={[
                    markdown({ base: markdownLanguage, codeLanguages: languages }),
                    props.commandKeymap,
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
          // Same gutter and content column as the editor above, so focusing a markdown
          // cell swaps the rendered output for its source in place.
          <div className="inner-content">
            <div className="cell-gutter" aria-hidden="true" />
            <div className="cellEditor">
              <Suspense fallback={<pre>{cellContents}</pre>}>
                <MarkdownRenderer source={cellContents} />
              </Suspense>
            </div>
          </div>
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
      {props.index === props.focusedIndex ? <CellButtons run={props.run} /> : <></>}

      <div className="inner-content">
        {props.execution_count === -1 ? (
          <LoaderSvg />
        ) : (
          // A cell that has not run has no count, and shows an empty bracket as Jupyter does.
          <div className="serial-no">[{props.execution_count ?? ' '}]:</div>
        )}
        <div className="cellEditor">
          <CodeMirror
            theme={theme.codeMirror}
            value={cellContents}
            height="auto"
            width="100%"
            extensions={[
              python(),
              kernelAutocompletion,
              [Prec.highest(keymap.of(tabCompletionKeymap))],
              props.commandKeymap,
            ]}
            autoFocus={props.index === props.focusedIndex ? true : false}
            onChange={onChange}
            onUpdate={onUpdate}
            onKeyDown={handleKeyDownCM}
            basicSetup={{
              lineNumbers: false,
              bracketMatching: true,
              highlightActiveLineGutter: true,
              autocompletion: false,
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
        props.promptCellId === props.cell.id && (
          <Prompt
            content={props.promptContent}
            submitPrompt={props.submitPrompt}
            toggleShowPrompt={props.toggleShowPrompt}
          />
        )}
      {/* Only when there is something to show — .inner-text has padding and a background,
          so an empty one is a tinted strip under every un-run cell. */}
      {cell.outputs && cell.outputs.length > 0 && (
        <div className="inner-text">
          <CellOutput data={cell} connection={props.connection} />
        </div>
      )}
    </div>
  );
});

export default Cell;
