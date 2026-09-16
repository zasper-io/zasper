import { describe, expect, it } from 'vitest';

import { NotebookCell, NotebookModel } from '@/api';

import { notebookToScript } from './toScript';

function cell(partial: Partial<NotebookCell>): NotebookCell {
  return {
    cell_type: 'code',
    id: 'c1',
    source: '',
    metadata: {},
    execution_count: null,
    outputs: [],
    reload: false,
    ...partial,
  };
}

function notebook(
  cells: NotebookCell[],
  language?: { name: string; file_extension: string }
): NotebookModel {
  return {
    cells,
    nbformat: 4,
    nbformat_minor: 5,
    metadata: language ? { language_info: language } : {},
  };
}

const python = { name: 'python', file_extension: '.py' };

describe('notebookToScript', () => {
  it('writes the code cells in order under percent markers', () => {
    const { text } = notebookToScript(
      notebook(
        [cell({ source: 'import pandas as pd' }), cell({ source: 'pd.read_csv("x")' })],
        python
      )
    );

    expect(text).toBe('# %%\nimport pandas as pd\n\n# %%\npd.read_csv("x")\n');
  });

  it('comments a markdown cell out under its own marker', () => {
    const { text } = notebookToScript(
      notebook([cell({ cell_type: 'markdown', source: '# Drift\n\nFourteen days.' })], python)
    );

    expect(text).toBe('# %% [markdown]\n# # Drift\n#\n# Fourteen days.\n');
  });

  it('marks a raw cell as raw', () => {
    const { text } = notebookToScript(
      notebook([cell({ cell_type: 'raw', source: 'verbatim' })], python)
    );

    expect(text).toBe('# %% [raw]\n# verbatim\n');
  });

  it('drops the outputs', () => {
    const { text } = notebookToScript(
      notebook(
        [cell({ source: 'print(1)', outputs: [{ output_type: 'stream', text: '1\n' }] })],
        python
      )
    );

    expect(text).toBe('# %%\nprint(1)\n');
  });

  it("takes the extension from the kernel's language", () => {
    expect(notebookToScript(notebook([], { name: 'julia', file_extension: '.jl' })).extension).toBe(
      'jl'
    );
    expect(notebookToScript(notebook([], python)).extension).toBe('py');
  });

  it('falls back to Python for a notebook that has never run', () => {
    expect(notebookToScript(notebook([cell({ source: 'x' })])).extension).toBe('py');
  });

  it('uses a comment marker the language actually has', () => {
    const { text, extension } = notebookToScript(
      notebook([cell({ source: 'console.log(1)' })], { name: 'javascript', file_extension: '.js' })
    );

    expect(extension).toBe('js');
    expect(text).toBe('// %%\nconsole.log(1)\n');
  });

  it("takes the attached kernel's language over what the file records", () => {
    const { text, extension } = notebookToScript(
      notebook([cell({ source: 'x <- 1' })], { name: 'python', file_extension: '.py' }),
      'r'
    );

    expect(extension).toBe('py');
    expect(text).toBe('# %%\nx <- 1\n');
  });

  // The common shape this exists for: a kernelspec naming no language, which nbformat allows and
  // plenty of real notebooks have, so the file itself says nothing about what it is written in.
  it('names the file from the kernel when the notebook records nothing', () => {
    expect(notebookToScript(notebook([cell({ source: 'x' })]), 'julia').extension).toBe('jl');
    expect(notebookToScript(notebook([cell({ source: 'x' })]), 'python').extension).toBe('py');
  });

  it('is empty for a notebook with nothing in it', () => {
    expect(notebookToScript(notebook([], python)).text).toBe('');
  });
});
