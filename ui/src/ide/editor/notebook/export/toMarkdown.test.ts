import { describe, expect, it } from 'vitest';

import { NotebookCell, NotebookModel } from '@/api';

import { notebookToMarkdown } from './toMarkdown';

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

function notebook(cells: NotebookCell[], language = 'python'): NotebookModel {
  return {
    cells,
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { language_info: { name: language, file_extension: '.py' } },
  };
}

describe('notebookToMarkdown', () => {
  it('writes a markdown cell as it was typed', () => {
    const md = notebookToMarkdown(
      notebook([cell({ cell_type: 'markdown', source: '# Drift\n\nFourteen days.' })])
    );

    expect(md).toBe('# Drift\n\nFourteen days.\n');
  });

  it("tags a code fence with the kernel's language", () => {
    const md = notebookToMarkdown(notebook([cell({ source: 'print(1)' })]));

    expect(md).toBe('```python\nprint(1)\n```\n');
  });

  it('leaves the fence untagged when the notebook names no language', () => {
    const bare: NotebookModel = {
      cells: [cell({ source: 'x' })],
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
    };

    expect(notebookToMarkdown(bare)).toBe('```\nx\n```\n');
  });

  it('lengthens the fence around a cell that contains one', () => {
    const md = notebookToMarkdown(notebook([cell({ source: 'x = """\n```\n"""' })]));

    expect(md).toContain('````python\n');
    expect(md.trimEnd().endsWith('````')).toBe(true);
  });

  it('writes a stream output as a plain block', () => {
    const md = notebookToMarkdown(
      notebook([
        cell({
          source: 'print("hi")',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi\n' }],
        }),
      ])
    );

    expect(md).toBe('```python\nprint("hi")\n```\n\n```\nhi\n```\n');
  });

  it('strips the escape codes out of a traceback', () => {
    const md = notebookToMarkdown(
      notebook([
        cell({
          source: 'boom()',
          outputs: [
            {
              output_type: 'error',
              ename: 'ValueError',
              evalue: 'bad window',
              traceback: ['[0;31mValueError[0m: bad window'],
            },
          ],
        }),
      ])
    );

    expect(md).toContain('ValueError: bad window');
    expect(md).not.toContain('');
  });

  it('inlines an image as a data URL', () => {
    const md = notebookToMarkdown(
      notebook([
        cell({
          source: 'plot()',
          outputs: [{ output_type: 'display_data', data: { 'image/png': 'AAAB' } }],
        }),
      ])
    );

    expect(md).toContain('![](data:image/png;base64,AAAB)');
  });

  it("keeps a DataFrame's HTML, which Markdown carries as-is", () => {
    const md = notebookToMarkdown(
      notebook([
        cell({
          outputs: [
            {
              output_type: 'execute_result',
              data: { 'text/html': '<table><tr><td>1</td></tr></table>' },
            },
          ],
        }),
      ])
    );

    expect(md).toContain('<table><tr><td>1</td></tr></table>');
  });

  it('says so rather than dumping a bundle it cannot show', () => {
    const md = notebookToMarkdown(
      notebook([
        cell({ outputs: [{ output_type: 'display_data', data: { 'model/gltf+json': {} } }] }),
      ])
    );

    expect(md).toContain('This output cannot be displayed (model/gltf+json)');
  });

  it('leaves the outputs out when asked to', () => {
    const md = notebookToMarkdown(
      notebook([
        cell({ source: 'print("hi")', outputs: [{ output_type: 'stream', text: 'hi\n' }] }),
      ]),
      { includeOutputs: false }
    );

    expect(md).toBe('```python\nprint("hi")\n```\n');
  });

  it('fences a raw cell rather than passing it off as prose', () => {
    const md = notebookToMarkdown(
      notebook([cell({ cell_type: 'raw', source: '\\begin{abstract}' })])
    );

    expect(md).toBe('```\n\\begin{abstract}\n```\n');
  });

  it('skips empty cells and ends the file with one newline', () => {
    const md = notebookToMarkdown(
      notebook([cell({ source: '   ' }), cell({ cell_type: 'markdown', source: 'Note' })])
    );

    expect(md).toBe('Note\n');
  });

  it('tags the fence from the attached kernel when the file names no language', () => {
    const bare: NotebookModel = {
      cells: [cell({ source: 'x' })],
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { name: 'python3', display_name: 'Python 3 (ipykernel)' } },
    };

    expect(notebookToMarkdown(bare, { language: 'python' })).toBe('```python\nx\n```\n');
  });

  it('is empty for a notebook with nothing in it', () => {
    expect(notebookToMarkdown(notebook([]))).toBe('');
  });
});
