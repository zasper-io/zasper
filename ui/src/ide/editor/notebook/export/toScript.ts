import { NotebookModel } from '@/api';

import { cellSource, notebookLanguage, scriptExtension } from './exportFormats';

/*
A notebook as a flat script — marimo's `export script`, and the answer to "I want the code, not the
notebook".

The markers are jupytext's percent format, which is also VS Code's and Spyder's: `# %%` opens a code
cell, `# %% [markdown]` a prose one, `# %% [raw]` a raw one. That makes the file two things at once —
a script that runs top to bottom, and a document those three editors reopen as cells.

Not to be confused with the markers the git diff writes (`# %% [1] code`, in
internal/gitclient/diff.go). Those number the cells because a diff is read, not run; jupytext would not
recognise them, so a script exported in that shape would never come back as a notebook.

Outputs are dropped. A script has nowhere to put a DataFrame, and a commented-out one is noise in the
only file whose whole point is that it is just the code.
*/

/**
 * Comment markers by language, for the few kernels that do not use `#`.
 *
 * `#` covers Python, Julia, R, Ruby and the shell — effectively every kernel a Zasper user has — and
 * is the fallback. The entries here exist because a script whose markers are not comments does not
 * run at all, which is a worse failure than an ugly one.
 */
const COMMENT_MARKERS: Record<string, string> = {
  javascript: '//',
  typescript: '//',
  scala: '//',
  go: '//',
  rust: '//',
  c: '//',
  cpp: '//',
  java: '//',
  matlab: '%',
  octave: '%',
  haskell: '--',
  sql: '--',
  lua: '--',
};

function commentMarker(language: string): string {
  return COMMENT_MARKERS[language.toLowerCase()] ?? '#';
}

export interface ScriptExport {
  text: string;
  /** Without the dot, for the filename the browser saves under. */
  extension: string;
}

/**
 * The notebook's code, in order, with the cell boundaries kept as comments.
 *
 * `attachedLanguage` is the language of the kernel the editor is talking to, which decides both the
 * file's extension and its comment marker when the notebook itself records neither.
 */
export function notebookToScript(notebook: NotebookModel, attachedLanguage?: string): ScriptExport {
  const extension = scriptExtension(notebook, attachedLanguage);
  const language = notebookLanguage(notebook, attachedLanguage);
  const marker = commentMarker(language);

  const chunks: string[] = [];

  for (const cell of notebook.cells) {
    const source = cellSource(cell.source).replace(/\n+$/, '');

    if (cell.cell_type === 'code') {
      chunks.push(`${marker} %%\n${source}`);
      continue;
    }

    // Prose and raw text become comments, one per line, so that the file still runs. A blank line
    // inside a markdown cell keeps its marker rather than becoming a bare newline: without it the
    // comment block reads as two, and jupytext would take the second as code.
    const kind = cell.cell_type === 'markdown' ? 'markdown' : 'raw';
    if (source.trim() === '') {
      continue;
    }
    const commented = source
      .split('\n')
      .map((line) => (line === '' ? marker : `${marker} ${line}`))
      .join('\n');
    chunks.push(`${marker} %% [${kind}]\n${commented}`);
  }

  return { text: chunks.length === 0 ? '' : `${chunks.join('\n\n')}\n`, extension };
}
