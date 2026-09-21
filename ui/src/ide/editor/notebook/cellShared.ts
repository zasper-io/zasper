import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Prec } from '@codemirror/state';
import { indentLess, indentMore } from '@codemirror/commands';
import { getIndentUnit, indentString } from '@codemirror/language';
import { EditorView, KeyBinding, keymap } from '@codemirror/view';

import { NotebookCell } from '@/api';
import { KernelMessage } from './kernelMessages';
import { useNotebookEditor } from './NotebookEditorContext';

/** What a cell is told by the list it is in; everything the cells share comes from the context. */
export interface CellProps {
  cell: NotebookCell;
  index: number;
  isFocused: boolean;
  /** True from the moment the cell is submitted until the kernel goes idle on it. */
  isRunning: boolean;
  /** Whether this cell's output has been let past the height cap `.inner-text` puts on it. */
  isOutputExpanded: boolean;
  /** Markdown cells: whether this one's source is open, rather than its rendered output. */
  isEditing: boolean;
  /** The kernel's `input()` prompt, when it is this cell the kernel is waiting on. */
  prompt?: KernelMessage;
}

/*
Module constants, like every extension a cell is handed: @uiw/react-codemirror reconfigures an editor
whenever `basicSetup` or `extensions` changes identity. A fresh literal rebuilt every editor in the
notebook several times per key typed — the lag reported against 1.1.0.
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
  // cell and search that cell alone, which is not a notebook's find.
  searchKeymap: false,
};
export const MARKDOWN_SETUP = { ...CELL_SETUP, autocompletion: true };
// Code cells complete through `cellIntelligence`; two autocompletion() instances fight over one facet.
export const CODE_SETUP = { ...CELL_SETUP, autocompletion: false };

/** Tab with Settings → Notebook → Insert a tab in a cell on: an indent at the cursor, never a completion. */
export const tabIndentKeymap: KeyBinding[] = [
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

function onFirstLine(view: EditorView): boolean {
  const { main } = view.state.selection;
  return main.empty && view.state.doc.lineAt(main.head).number === 1;
}

function onLastLine(view: EditorView): boolean {
  const { main } = view.state.selection;
  return main.empty && view.state.doc.lineAt(main.head).number === view.state.doc.lines;
}

/**
 * The keys that leave edit mode, as keymaps with a precedence rather than handlers around the editor, so
 * that whatever else the editor has open is asked first.
 *
 * The arrows are high: ahead of CodeMirror's own cursor motion, which on the last line would first move
 * to its end, but behind the completion list, whose keymap is highest and takes the arrows while it is
 * open. Escape is low: a popup, a documentation card or a multiple selection is closed by it first, and
 * only an Escape nothing else wanted leaves the cell — for a markdown cell, rendering it again.
 */
export function useLeaveCellKeymap(cellId: string, renderOnEscape: boolean) {
  const { focusNextCell, focusPreviousCell, focusCellBox, endEditing } = useNotebookEditor();
  return useMemo(
    () => [
      Prec.high(
        keymap.of([
          { key: 'ArrowDown', run: (view) => onLastLine(view) && (focusNextCell(false), true) },
          { key: 'ArrowUp', run: (view) => onFirstLine(view) && (focusPreviousCell(), true) },
        ])
      ),
      Prec.low(
        keymap.of([
          {
            key: 'Escape',
            run: () => {
              if (renderOnEscape) {
                endEditing();
              }
              focusCellBox(cellId);
              return true;
            },
          },
        ])
      ),
    ],
    [cellId, renderOnEscape, focusNextCell, focusPreviousCell, focusCellBox, endEditing]
  );
}

/**
 * A cell's editor, handed to the notebook as it is made and taken back as the cell goes: the notebook's
 * find dispatches into these, and a destroyed view is not one to dispatch into.
 */
export function useCellView(cellId: string) {
  const { registerCellView } = useNotebookEditor();
  const view = useRef<EditorView | null>(null);
  const keepView = useCallback(
    (created: EditorView) => {
      view.current = created;
      registerCellView(cellId, created);
    },
    [registerCellView, cellId]
  );
  useEffect(() => () => registerCellView(cellId, null), [registerCellView, cellId]);
  return { view, keepView };
}

/**
 * The props of a cell's own box: the element that holds the keyboard in command mode, which the
 * dispatcher recognises by `data-command-mode`. Only the focused cell is in the Tab order — a roving
 * tabindex — so Tab leaves the notebook rather than walking every cell in it.
 */
export function useCellBox(cellId: string, isFocused: boolean) {
  const { registerCellBox, focusCell } = useNotebookEditor();
  const ref = useCallback(
    (box: HTMLDivElement | null) => registerCellBox(cellId, box),
    [registerCellBox, cellId]
  );
  return {
    ref,
    tabIndex: isFocused ? 0 : -1,
    'data-command-mode': '',
    className: isFocused ? 'single-line activeCell' : 'single-line',
    onFocus: () => focusCell(cellId),
  } satisfies React.HTMLAttributes<HTMLDivElement> & {
    ref: React.Ref<HTMLDivElement>;
    'data-command-mode': string;
  };
}
