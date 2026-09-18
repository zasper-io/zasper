import React, { lazy, Suspense, useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';

import IconButton from '@/ide/IconButton';
import { useTheme } from '@/themes/useTheme';
import CellButtons from './CellButtons';
import {
  CellProps,
  MARKDOWN_SETUP,
  useCellBox,
  useCellView,
  useLeaveCellKeymap,
} from './cellShared';
import { useNotebookEditor } from './NotebookEditorContext';
import { zoomAwareTooltips } from '../tooltipParent';

// react-markdown + remark-math + rehype-katex is the heaviest thing in the notebook and nothing needs it
// until a markdown cell is actually rendered, so it loads on demand. See MarkdownRenderer.tsx.
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

const MARKDOWN_LANGUAGE = markdown({ base: markdownLanguage, codeLanguages: languages });

/** A markdown cell: its rendered prose, or its source while it is open for editing. */
export default function MarkdownCell(props: CellProps) {
  const { cell, isFocused } = props;
  const editor = useNotebookEditor();
  const { updateCellSource, findExtension, commandKeymap } = editor;
  const theme = useTheme();
  const { keepView } = useCellView(cell.id);
  const box = useCellBox(cell.id, isFocused);
  const leaveCell = useLeaveCellKeymap(cell.id, true);

  const cellId = cell.id;
  const onChange = useCallback(
    (value: string) => updateCellSource(value, cellId),
    [cellId, updateCellSource]
  );

  const popupPlacement = useMemo(() => zoomAwareTooltips(), []);
  // Memoized for the reason CELL_SETUP gives.
  const extensions = useMemo(
    () => [MARKDOWN_LANGUAGE, popupPlacement, leaveCell, findExtension, commandKeymap],
    [popupPlacement, leaveCell, findExtension, commandKeymap]
  );

  // Focus selects; editing is asked for. An empty cell is the exception — rendered, it is nothing at
  // all, so there would be no way to click into it.
  const isEditing = isFocused && (props.isEditing || cell.source.trim() === '');

  return (
    <div {...box}>
      <CellButtons run={editor.run} cellType={cell.cell_type} />
      {isEditing ? (
        <div className="inner-content">
          {/* A markdown cell has no execution count, but it still needs the gutter a code cell's
              `[n]:` occupies, or the two cell types sit on different left edges. Open for editing it
              is the one markdown case the gutter offers anything for, because running a markdown
              cell is what renders it. */}
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
              value={cell.source}
              height="auto"
              width="100%"
              extensions={extensions}
              autoFocus
              onCreateEditor={keepView}
              onChange={onChange}
              basicSetup={MARKDOWN_SETUP}
            />
          </div>
        </div>
      ) : (
        // Same gutter and content column as the editor above, so opening a markdown cell swaps the
        // rendered output for its source in place. A double-click is what opens it — a single click
        // only selects, so scrolling past prose and clicking near it does not turn it into source.
        <div className="inner-content" onDoubleClick={() => editor.beginEditing(cellId)}>
          <div className="cell-gutter" aria-hidden="true" />
          {/* `is-rendered`: prose rather than an editor, and the box that carries the focused cell's
              left edge in its own right. */}
          <div className="cellEditor is-rendered">
            <Suspense fallback={<pre>{cell.source}</pre>}>
              <MarkdownRenderer source={cell.source} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
