import React, { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import CodeMirror, { Prec } from '@uiw/react-codemirror';
import { indentLess, indentMore } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { getIndentUnit, indentString } from '@codemirror/language';
import { EditorView, KeyBinding, keymap, ViewUpdate } from '@codemirror/view';
import { languages } from '@codemirror/language-data';
import { useAtomValue } from 'jotai';

import { NotebookCell } from '@/api';
import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { editorSettingsAtom } from '@/store/settings';
import { useTheme } from '@/themes/useTheme';
import CellButtons from './CellButtons';
import CellOutput from './CellOutput';
import Prompt from './Prompt';
import { cellIntelligence } from './cellIntelligence';
import { tabCompletionKeymap } from './kernelCompletion';
import { zoomAwareTooltips } from '../tooltipParent';
import { useNotebookEditor } from './NotebookEditorContext';

// react-markdown + remark-math + rehype-katex is the heaviest thing in the
// notebook and nothing needs it until a markdown cell is actually rendered, so
// it loads on demand. See MarkdownRenderer.tsx.
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

/** Tab with Settings → Notebook → Insert a tab in a cell on: an indent at the cursor, never a completion. */
const tabIndentKeymap: KeyBinding[] = [
  {
    key: 'Tab',
    run: (view) => {
      const { state } = view;
      if (state.selection.ranges.some((range) => !range.empty)) {
        return indentMore(view);
      }
      view.dispatch(
        state.update(state.replaceSelection(indentString(state, getIndentUnit(state))), {
          scrollIntoView: true,
          userEvent: 'input',
        })
      );
      return true;
    },
    shift: indentLess,
  },
];

/*
Module constants, like every extension a cell is handed: @uiw/react-codemirror reconfigures an editor
whenever `basicSetup` or `extensions` changes identity, and every cell re-renders on each keystroke and
each kernel status message. A fresh literal here rebuilt every editor in the notebook several times per
key typed — the lag reported against 1.1.0.
*/
const CELL_SETUP = {
  lineNumbers: false,
  bracketMatching: true,
  highlightActiveLineGutter: true,
  lintKeymap: true,
  foldGutter: true,
  completionKeymap: true,
  tabSize: 4,
  // The notebook's find is the notebook's: the library's `⌘F` would open its own panel inside this one
  // cell and search that cell alone, which is the defect story 17 is about.
  searchKeymap: false,
};
const MARKDOWN_SETUP = { ...CELL_SETUP, autocompletion: true };
// Code cells complete through `cellIntelligence`; two autocompletion() instances fight over one facet.
const CODE_SETUP = { ...CELL_SETUP, autocompletion: false };

interface CellProps {
  cell: NotebookCell;
  index: number;
  /** True from the moment the cell is submitted until the kernel goes idle on it. */
  isRunning: boolean;
  /** Whether this cell's output has been let past the height cap `.inner-text` puts on it. */
  isOutputExpanded: boolean;
  /** Markdown cells: whether this one's source is open, rather than its rendered output. */
  isEditing: boolean;
}

export interface CodeMirrorRef {
  editor: {
    focus: () => void;
  };
}

const Cell = React.forwardRef((props: CellProps, ref) => {
  const { cell } = props;
  const editor = useNotebookEditor();
  const { updateCellSource, requestCompletions, requestInspection, kernelIdle, languageServer } =
    editor;
  const theme = useTheme();
  const cellTabIndents = useAtomValue(editorSettingsAtom).cell_tab_indents;
  const { registerCellView } = editor;
  // Handed over as the editor is made, and taken back as the cell goes: the notebook's find dispatches
  // into these, and a view that has been destroyed is not one to dispatch into.
  // As well as the registry's copy: Enter in command mode gives this cell's editor the keyboard back,
  // and that is this component's business rather than the notebook's.
  const view = useRef<EditorView | null>(null);
  const keepView = useCallback(
    (created: EditorView) => {
      view.current = created;
      registerCellView(cell.id, created);
    },
    [registerCellView, cell.id]
  );
  useEffect(() => () => registerCellView(cell.id, null), [registerCellView, cell.id]);
  const [cellContents, setCellContents] = useState(cell.source);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [totalLines, setTotalLines] = useState(0);

  const cellId = cell.id;
  const onChange = useCallback(
    (value: string) => {
      setCellContents(value);
      updateCellSource(value, cellId);
    },
    [cellId, updateCellSource]
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
    // Escape is Jupyter's way out of edit mode, and the cell's box is where command mode lives.
    // The markdown cell's own handler below renders the cell first and then comes here.
    // Unless the editor used it first, to close a popup or a documentation card.
    if (event.key === 'Escape' && event.defaultPrevented) {
      return;
    }
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      editor.focusCellBox(props.index);
      event.preventDefault();
      return;
    }
    // A modified arrow is somebody else's chord — `Ctrl-Shift-ArrowUp` moves the cell, and Shift
    // extends the selection — so only the bare key leaves the cell. Without this test the modified
    // presses did both: `Ctrl-Shift-ArrowUp` on the first line of a cell moved the selection up as
    // well as moving the cell, which left the two one apart and moved the wrong cell next time.
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    if (event.key === 'ArrowDown' && cursorPosition === totalLines) {
      editor.focusNextCell(false);
      event.preventDefault();
    } else if (event.key === 'ArrowUp' && cursorPosition === 1) {
      editor.focusPreviousCell();
      event.preventDefault();
    }
  };

  /** Escape renders a markdown cell again, as Jupyter's Escape leaves edit mode. */
  const handleMarkdownKeyDownCM = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      editor.endEditing();
    }
    handleKeyDownCM(event);
  };

  // Memoized with everything else a cell's editor is given: see CELL_SETUP.
  const intelligence = useMemo(
    () =>
      cellIntelligence(
        {
          cellId: cell.id,
          server: languageServer,
          requestCompletions,
          requestInspection,
          kernelIdle,
        },
        !cellTabIndents
      ),
    [cell.id, languageServer, requestCompletions, requestInspection, kernelIdle, cellTabIndents]
  );

  // See tooltipParent.ts for why a cell has to say where its popup hangs at all: without this it draws
  // at its own coordinate times the zoom.
  const popupPlacement = useMemo(() => zoomAwareTooltips(), []);

  const { cellLanguage, findExtension, commandKeymap } = editor;
  const codeExtensions = useMemo(
    () => [
      cellLanguage,
      intelligence,
      popupPlacement,
      Prec.highest(keymap.of(cellTabIndents ? tabIndentKeymap : tabCompletionKeymap)),
      findExtension,
      commandKeymap,
    ],
    [cellLanguage, intelligence, popupPlacement, cellTabIndents, findExtension, commandKeymap]
  );
  const markdownExtensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      popupPlacement,
      findExtension,
      commandKeymap,
    ],
    [popupPlacement, findExtension, commandKeymap]
  );

  // Make sure divRefs.current is not null before assigning
  const divRef = (el: HTMLDivElement | null) => {
    if (editor.divRefs.current) {
      editor.divRefs.current[props.index] = el;
    }
  };

  if (cell.cell_type === 'markdown') {
    const isFocused = props.index === editor.focusedIndex;
    // Focus selects; editing is asked for. An empty cell is the exception — rendered, it is nothing
    // at all, so there would be no way to click into it.
    const isEditing = isFocused && (props.isEditing || cellContents.trim() === '');

    return (
      <div
        tabIndex={props.index}
        className={isFocused ? 'single-line activeCell' : 'single-line'}
        ref={divRef}
        onFocus={() => editor.focusCell(cell.id)}
        // Enter opens the source of a focused-but-rendered cell, the way Jupyter's command mode
        // does. Guarded on the target so it cannot fire for an Enter typed inside the editor.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !isEditing && event.target === event.currentTarget) {
            editor.beginEditing(cell.id);
            event.preventDefault();
          }
        }}
      >
        {isEditing ? (
          <>
            <CellButtons run={editor.run} cellType={cell.cell_type} />
            <div className="inner-content">
              {/* A markdown cell has no execution count, but it still needs the gutter a
                  code cell's `[n]:` occupies, or the two cell types sit on different
                  left edges. Open for editing it is the one markdown case the gutter offers
                  anything for, because running a markdown cell is what renders it. */}
              <div className="cell-gutter has-run">
                <IconButton
                  icon="play"
                  className="cell-run"
                  label="Render Markdown"
                  name="Render this markdown cell"
                  onClick={() => editor.endEditing()}
                />
              </div>
              <div className="cellEditor">
                <CodeMirror
                  theme={theme.codeMirror}
                  value={cellContents}
                  height="auto"
                  width="100%"
                  extensions={markdownExtensions}
                  autoFocus
                  onCreateEditor={keepView}
                  onChange={onChange}
                  onUpdate={onUpdate}
                  onKeyDown={handleMarkdownKeyDownCM}
                  basicSetup={MARKDOWN_SETUP}
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
            <CellButtons run={editor.run} cellType={cell.cell_type} />
            <div className="inner-content" onDoubleClick={() => editor.beginEditing(cell.id)}>
              <div className="cell-gutter" aria-hidden="true" />
              {/* `is-rendered`: prose rather than an editor, and the box that carries the focused
                  cell's left edge in its own right. */}
              <div className="cellEditor is-rendered">
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
      className={props.index === editor.focusedIndex ? 'single-line activeCell' : 'single-line'}
      ref={divRef}
      onFocus={() => editor.focusCell(cell.id)}
      // The other half of Jupyter's two modes: Enter on the cell's box is edit mode, which for a code
      // cell means giving its editor the keyboard — a markdown cell opens its source instead, above.
      // Guarded on the target so it cannot fire for an Enter typed inside the editor.
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          view.current?.focus();
          event.preventDefault();
        }
      }}
    >
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
              // A spinner rather than `[*]`. This used to test `execution_count === -1`, which is
              // only true between submitting the cell and the kernel's `execute_input` — a few
              // milliseconds — after which the count arrives and a cell that went on running for a
              // minute showed a stale `[17]:` and nothing else.
              //
              // It keeps the name the box it replaced carried: which cell the kernel is on is the
              // one thing in this gutter a screen reader has to be told, and the count beside it
              // reads for itself.
              <span className="z-spinner" role="status" aria-label="Running" />
            ) : (
              // A cell that has not run has no count, and shows an empty bracket as Jupyter does. A
              // raw cell never runs, so it has no bracket at all: the brackets are the execution
              // column, and drawing an empty one beside a cell that can never fill it says the cell
              // is waiting to run.
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
                props.isRunning
                  ? editor.interruptKernel()
                  : editor.submitCell(cellContents, props.cell.id)
              }
            />
          )}
        </div>
        <div className="cellEditor">
          <CodeMirror
            theme={theme.codeMirror}
            value={cellContents}
            height="auto"
            width="100%"
            extensions={codeExtensions}
            autoFocus={props.index === editor.focusedIndex ? true : false}
            onCreateEditor={keepView}
            onChange={onChange}
            onUpdate={onUpdate}
            onKeyDown={handleKeyDownCM}
            basicSetup={CODE_SETUP}
          />
        </div>
      </div>
      {editor.showPrompt &&
        editor.promptContent &&
        editor.promptContent.content &&
        editor.promptCellId === props.cell.id && (
          <Prompt
            content={editor.promptContent}
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
});

export default Cell;
