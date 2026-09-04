import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import languageFor from './language';

/**
 * Which language an extension resolves to, asked of the resolved language itself.
 *
 * `LanguageSupport` values carry no name worth asserting on, so the question is put to the language the
 * way the editor puts it: what a comment looks like. `#` is Python's answer and `//` is Go's, which is
 * the pair that matters here.
 */
function lineComment(extension: string | null): string | undefined {
  const support = languageFor(extension);
  const state = EditorState.create({
    doc: 'anything',
    extensions: support === null ? [] : [support],
  });
  const tokens = state.languageDataAt<{ line?: string }>('commentTokens', 0);
  return tokens[0]?.line;
}

describe('languageFor', () => {
  // The switch this was extracted from tested for 'python', which is not an extension any file has, so
  // every .py file in the editor was highlighted as Go.
  it('highlights a Python file as Python', () => {
    expect(lineComment('py')).toBe('#');
  });

  // A notebook diff is the source of its cells with `# %%` markers between them, which is Python.
  it('highlights a notebook as Python', () => {
    expect(lineComment('ipynb')).toBe('#');
  });

  it('is case-insensitive, since an extension is not a keyword', () => {
    expect(lineComment('PY')).toBe('#');
    expect(lineComment('Go')).toBe('//');
  });

  // Nothing rather than a guess: the caller decides what an unknown file is treated as, and the editor
  // and the diff want different answers.
  it('answers nothing for an extension it does not know, and for no extension at all', () => {
    expect(languageFor('conf')).toBeNull();
    expect(languageFor(null)).toBeNull();
  });
});
