import { RefObject, useEffect, useRef } from 'react';

import { MergeView } from '@codemirror/merge';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

import getFileExtension from '@/ide/utils';
import { baseName } from '@/paths';
import { useTheme } from '@/themes/useTheme';
import languageFor, { lazyLanguageFor } from './language';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * The arrow between the two sides that undoes a block, as the app's own icon button: CodeMirror's is a
 * bare glyph. Built by hand because CodeMirror wants a DOM node, not a component; the paths are
 * Lucide's `undo-2`, at the stroke the icon table uses.
 */
function revertControl(): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'z-icon-button cm-merge-undo';
  button.title = 'Undo this change';
  button.setAttribute('aria-label', 'Undo this change');
  const icon = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({
    width: '14',
    height: '14',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  })) {
    icon.setAttribute(name, value);
  }
  for (const d of ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11']) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    icon.appendChild(path);
  }
  button.appendChild(icon);
  return button;
}

/**
 * Two versions of the file at `path` side by side in `container`, `original` on the left, both read
 * only. Nothing is drawn while either is null. With `onRevert`, each changed block has an arrow that
 * puts the left side's text back on the right, and `onRevert` is given the right side's text after.
 */
export function useMergeView(
  container: RefObject<HTMLDivElement>,
  original: string | null,
  modified: string | null,
  path: string,
  onRevert?: (modified: string) => void
): void {
  const theme = useTheme();
  const reverted = useRef(onRevert);
  reverted.current = onRevert;
  const reverts = onRevert !== undefined;

  useEffect(() => {
    const parent = container.current;
    if (parent === null || original === null || modified === null) {
      return;
    }
    let view: MergeView | null = null;
    let live = true;
    const build = (language: Extension | null) => {
      if (!live) {
        return;
      }
      const readOnly = [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        theme.codeMirror,
        ...(language === null ? [] : [language]),
      ];
      // Read only to the keyboard: a revert is a transaction of the view's own, which still applies.
      const told = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          reverted.current?.(update.state.doc.toString());
        }
      });
      view = new MergeView({
        a: { doc: original, extensions: readOnly },
        b: { doc: modified, extensions: reverts ? [...readOnly, told] : readOnly },
        parent,
        gutter: true,
        highlightChanges: true,
        ...(reverts
          ? { revertControls: 'a-to-b' as const, renderRevertControl: revertControl }
          : {}),
        // A file with one changed line in a thousand is otherwise a diff someone has to go looking
        // through for it.
        collapseUnchanged: { margin: 3, minSize: 4 },
      });
    };

    // A language nothing bundles is loaded first, so the diff is drawn once and highlighted.
    const bundled = languageFor(getFileExtension(path));
    const loading = bundled === null ? lazyLanguageFor(baseName(path)) : null;
    if (loading === null) {
      build(bundled);
    } else {
      loading.then(build, () => build(null));
    }
    return () => {
      live = false;
      view?.destroy();
    };
  }, [container, original, modified, path, theme, reverts]);
}
