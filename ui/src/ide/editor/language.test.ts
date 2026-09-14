import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import languageFor, { lazyLanguageFor, lazyLanguageNamed } from './language';

/**
 * Which language an extension resolves to, asked of the resolved language itself.
 *
 * `LanguageSupport` values carry no name worth asserting on, so the question is put to the language the
 * way the editor puts it: what a comment looks like. `#` is Python's answer and `//` is Go's, which is
 * the pair that matters here.
 */
function commentOf(support: import('@codemirror/state').Extension | null): string | undefined {
  const state = EditorState.create({
    doc: 'anything',
    extensions: support === null ? [] : [support],
  });
  return state.languageDataAt<{ line?: string }>('commentTokens', 0)[0]?.line;
}

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

  // Loaded on demand from @codemirror/language-data, so an extension nothing bundles is still highlighted.
  it("finds a language it does not bundle by the file's name, and loads it", async () => {
    expect(commentOf(await lazyLanguageFor('main.rs'))).toBe('//');
    expect(commentOf(await lazyLanguageFor('Dockerfile'))).toBe('#');
  });

  it('has nothing for a file no language claims, which is plain text', () => {
    expect(lazyLanguageFor('notes.txt')).toBeNull();
  });

  // A notebook's code cells follow its kernel: R, Julia and the rest are not Python.
  it("finds a kernel's language by its name", async () => {
    expect(commentOf(await lazyLanguageNamed('R'))).toBe('#');
    expect(commentOf(await lazyLanguageNamed('julia'))).toBe('#');
    expect(lazyLanguageNamed('no such language')).toBeNull();
  });
});
