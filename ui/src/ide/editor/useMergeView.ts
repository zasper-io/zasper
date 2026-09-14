import { RefObject, useEffect } from 'react';

import { MergeView } from '@codemirror/merge';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

import getFileExtension from '@/ide/utils';
import { baseName } from '@/paths';
import { useTheme } from '@/themes/useTheme';
import languageFor, { lazyLanguageFor } from './language';

/**
 * Two versions of the file at `path` side by side in `container`, `original` on the left, both read
 * only. Nothing is drawn while either is null.
 */
export function useMergeView(
  container: RefObject<HTMLDivElement>,
  original: string | null,
  modified: string | null,
  path: string
): void {
  const theme = useTheme();

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
      view = new MergeView({
        a: { doc: original, extensions: readOnly },
        b: { doc: modified, extensions: readOnly },
        parent,
        gutter: true,
        highlightChanges: true,
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
  }, [container, original, modified, path, theme]);
}
