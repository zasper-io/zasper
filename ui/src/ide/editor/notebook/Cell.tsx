import React, { useState, useCallback, useMemo, lazy, Suspense } from 'react';
import CodeMirror, { Prec, type Extension } from '@uiw/react-codemirror';
import { autocompletion } from '@codemirror/autocomplete';
import { python } from '@codemirror/lang-python';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { keymap, ViewUpdate } from '@codemirror/view';
import { languages } from '@codemirror/language-data';

import { ICell } from '@/api';
import { Icon } from '@/ide/icons';
import { useTheme } from '@/themes/useTheme';
import CellButtons from './CellButtons';
import CellOutput from './CellOutput';
import Prompt from './Prompt';
import { kernelCompletionSource, tabCompletionKeymap } from './kernelCompletion';
import { zoomAwareTooltips } from '../tooltipParent';
import { ICompleteReply, IKernelMessage } from './kernelMessages';
import type { WidgetBridge } from '@/ide/widgets/widgetBridge';

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
  /** By id, not by index: see `focusCell` in useNotebookCells for why the index cannot be trusted
   *  in a focus handler. */
  focusCell: (cellId: string) => void;
  divRefs: React.RefObject<(HTMLDivElement | null)[]>;
  /** null until the cell has run, -1 while it is running, and absent on a non-code cell. */
  execution_count: number | null | undefined;
  /** True from the moment the cell is submitted until the kernel goes idle on it. */
  isRunning: boolean;
  /**
   * Runs this cell, by id rather than through the command registry.
   *
   * `notebook:run-cell` acts on whatever `focusedIndex` says, and the gutter's button belongs to one
   * particular cell. Clicking it does move the focus — a focus event bubbles out of the button to
   * the cell — but `setFocusedIndex` is a state write, so the command dispatched in the same tick
   * would still be closed over the old index and would run the cell you were on before.
   */
  submitCell: (source: string, cellId: string) => void;
  /** The kernel-wide interrupt, which is what a running cell's stop button has to offer: there is
   *  no per-cell interrupt in the protocol the app speaks. */
  interruptKernel: () => void;
  /** Whether this cell's output has been let past the height cap `.inner-text` puts on it. */
  isOutputExpanded: boolean;
  /** Markdown cells: whether this one's source is open, rather than its rendered output. */
  isEditing: boolean;
  beginEditing: (cellId: string) => void;
  endEditing: () => void;
  codeMirrorRefs: React.RefObject<CodeMirrorRef[] | null>;
  updateCellSource: (value: string, cellId: string) => void;
  showPrompt: Boolean;
  promptContent: IKernelMessage;
  promptCellId: string | undefined;
  submitPrompt: (parentHeader: IKernelMessage, inputValue: string) => void;
  toggleShowPrompt: () => void;
  requestCompletions: (source: string, cursorPos: number) => Promise<ICompleteReply | null>;
  widgets: WidgetBridge | null;
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
    // A modified arrow is somebody else's chord — `Ctrl-Shift-ArrowUp` moves the cell, and Shift
    // extends the selection — so only the bare key leaves the cell. Without this test the modified
    // presses did both: `Ctrl-Shift-ArrowUp` on the first line of a cell moved the selection up as
    // well as moving the cell, which left the two one apart and moved the wrong cell next time.
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    if (event.key === 'ArrowDown' && cursorPosition === totalLines) {
      props.focusNextCell(false);
      event.preventDefault();
    } else if (event.key === 'ArrowUp' && cursorPosition === 1) {
      props.focusPreviousCell();
      event.preventDefault();
    }
  };

  /** Escape renders a markdown cell again, as Jupyter's Escape leaves edit mode. */
  const handleMarkdownKeyDownCM = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      props.endEditing();
      event.preventDefault();
      return;
    }
    handleKeyDownCM(event);
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

  // Memoized for the same reason as the line above, and see tooltipParent.ts for why a cell has to
  // say where its popup hangs at all: without this it draws at its own coordinate times the zoom.
  const popupPlacement = useMemo(() => zoomAwareTooltips(), []);

  // Make sure divRefs.current is not null before assigning
  const divRef = (el: HTMLDivElement | null) => {
    if (props.divRefs.current) {
      props.divRefs.current[props.index] = el;
    }
  };

  if (cell.cell_type === 'markdown') {
    const isFocused = props.index === props.focusedIndex;
    // Focus selects; editing is asked for. An empty cell is the exception — rendered, it is nothing
    // at all, so there would be no way to click into it.
    const isEditing = isFocused && (props.isEditing || cellContents.trim() === '');

    return (
      <div
        tabIndex={props.index}
        className={isFocused ? 'single-line activeCell' : 'single-line'}
        ref={divRef}
        onFocus={() => props.focusCell(cell.id)}
        // Enter opens the source of a focused-but-rendered cell, the way Jupyter's command mode
        // does. Guarded on the target so it cannot fire for an Enter typed inside the editor.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !isEditing && event.target === event.currentTarget) {
            props.beginEditing(cell.id);
            event.preventDefault();
          }
        }}
      >
        {isEditing ? (
          <>
            <CellButtons run={props.run} cellType={cell.cell_type} />
            <div className="inner-content">
              {/* A markdown cell has no execution count, but it still needs the gutter a
                  code cell's `[n]:` occupies, or the two cell types sit on different
                  left edges. Open for editing it is the one markdown case the gutter offers
                  anything for, because running a markdown cell is what renders it. */}
              <div className="cell-gutter has-run">
                <button
                  type="button"
                  className="z-icon-button cell-run"
                  onClick={() => props.endEditing()}
                  title="Render Markdown"
                  aria-label="Render this markdown cell"
                >
                  <Icon name="play" />
                </button>
              </div>
              <div className="cellEditor">
                <CodeMirror
                  theme={theme.codeMirror}
                  value={cellContents}
                  height="auto"
                  width="100%"
                  extensions={[
                    markdown({ base: markdownLanguage, codeLanguages: languages }),
                    popupPlacement,
                    props.commandKeymap,
                  ]}
                  autoFocus
                  onChange={onChange}
                  onUpdate={onUpdate}
                  onKeyDown={handleMarkdownKeyDownCM}
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
          // Same gutter and content column as the editor above, so opening a markdown cell swaps
          // the rendered output for its source in place. A double-click is what opens it — a single
          // click only selects, which is the whole point: scrolling past prose and clicking near it
          // used to turn it back into raw markdown with no obvious way back.
          <>
            <CellButtons run={props.run} cellType={cell.cell_type} />
            <div className="inner-content" onDoubleClick={() => props.beginEditing(cell.id)}>
              <div className="cell-gutter" aria-hidden="true" />
              <div className="cellEditor">
                <Suspense fallback={<pre>{cellContents}</pre>}>
                  <MarkdownRenderer source={cellContents} />
                </Suspense>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      tabIndex={props.index}
      className={props.index === props.focusedIndex ? 'single-line activeCell' : 'single-line'}
      ref={divRef}
      onFocus={() => props.focusCell(cell.id)}
    >
      <CellButtons run={props.run} cellType={cell.cell_type} />

      <div className="inner-content">
        {/* The count and the button that runs the cell share one 22px box, so the swap between them
            cannot move a pixel of the notebook. At rest the gutter says what it has always said —
            the execution count, or a spinner while the kernel is on this cell — and under the
            pointer it becomes the action, which is beside the code rather than at the far end of
            it. Run used to be the first of eleven icons in a bar at the cell's top-right corner. */}
        <div className={cell.cell_type === 'code' ? 'cell-gutter has-run' : 'cell-gutter'}>
          <span className="serial-no">
            {props.isRunning ? (
              // A spinner rather than `[*]`. This used to test `execution_count === -1`, which is
              // only true between submitting the cell and the kernel's `execute_input` — a few
              // milliseconds — after which the count arrives and a cell that went on running for a
              // minute showed a stale `[17]:` and nothing else.
              //
              // It keeps the name the box it replaced carried: which cell the kernel is on is the
              // one thing in this gutter a screen reader has to be told, and the count beside it
              // reads for itself.
              <span className="z-spinner" role="status" title="Running" aria-label="Running" />
            ) : (
              // A cell that has not run has no count, and shows an empty bracket as Jupyter does. A
              // raw cell never runs, so it has no bracket at all: the brackets are the execution
              // column, and drawing an empty one beside a cell that can never fill it says the cell
              // is waiting to run.
              cell.cell_type === 'code' && `[${props.execution_count ?? ' '}]:`
            )}
          </span>
          {/* A raw cell is neither run nor rendered, as in Jupyter, so its gutter stays a gutter:
              the rule is that the button appears where pressing it would change something. */}
          {cell.cell_type === 'code' && (
            <button
              type="button"
              className="z-icon-button cell-run"
              onClick={() =>
                props.isRunning
                  ? props.interruptKernel()
                  : props.submitCell(cellContents, props.cell.id)
              }
              title={props.isRunning ? 'Interrupt Kernel' : 'Run Cell'}
              aria-label={props.isRunning ? 'Interrupt Kernel' : `Run cell ${props.index + 1}`}
            >
              <Icon name={props.isRunning ? 'square' : 'play'} />
            </button>
          )}
        </div>
        <div className="cellEditor">
          <CodeMirror
            theme={theme.codeMirror}
            value={cellContents}
            height="auto"
            width="100%"
            extensions={[
              python(),
              kernelAutocompletion,
              popupPlacement,
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
        <div className={props.isOutputExpanded ? 'inner-text is-expanded' : 'inner-text'}>
          <CellOutput data={cell} widgets={props.widgets} />
        </div>
      )}
    </div>
  );
});

export default Cell;
