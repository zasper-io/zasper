import { indentUnit } from '@codemirror/language';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, highlightWhitespace } from '@codemirror/view';

import type { EditorSettings } from '@/api';
import type { Indentation } from '@/store/editorStatus';

/**
 * A one-pixel guide behind the text at each column. `ch` is one character of the code face, and 6px is a
 * line's own left padding in CodeMirror's base theme.
 */
export function rulers(columns: number[]): Extension {
  if (columns.length === 0) {
    return [];
  }
  const each = (value: (column: number) => string) => columns.map(value).join(', ');
  return EditorView.theme({
    '.cm-content': {
      backgroundImage: each(
        () => 'linear-gradient(var(--z-border-indent-guide), var(--z-border-indent-guide))'
      ),
      backgroundSize: each(() => '1px 100%'),
      backgroundPosition: each((column) => `calc(6px + ${column}ch) 0`),
      backgroundRepeat: 'no-repeat',
    },
  });
}

/** The editor settings, with the indentation the file is edited with, as CodeMirror extensions. */
export function editorExtensions(
  settings: EditorSettings,
  { indentWithTabs, tabSize }: Indentation
): Extension {
  return [
    indentUnit.of(indentWithTabs ? '\t' : ' '.repeat(tabSize)),
    EditorState.tabSize.of(tabSize),
    // Two classes, so the size wins over the one `.cm-editor` is given in _codemirror.scss.
    EditorView.theme({ '&.cm-editor': { fontSize: `${settings.font_size}px` } }),
    settings.word_wrap ? EditorView.lineWrapping : [],
    settings.show_whitespace ? highlightWhitespace() : [],
    rulers(settings.rulers),
  ];
}
