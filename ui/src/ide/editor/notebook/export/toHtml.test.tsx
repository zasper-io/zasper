import { describe, expect, it } from 'vitest';

import { NotebookCell, NotebookModel } from '@/api';

import { notebookToHtml } from './toHtml';

function cell(partial: Partial<NotebookCell>): NotebookCell {
  return {
    cell_type: 'code',
    id: Math.random().toString(36).slice(2),
    source: '',
    metadata: {},
    execution_count: null,
    outputs: [],
    reload: false,
    ...partial,
  };
}

function notebook(cells: NotebookCell[]): NotebookModel {
  return {
    cells,
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { language_info: { name: 'python', file_extension: '.py' } },
  };
}

const title = 'analysis.ipynb';

/** The document's text, for asserting on source that highlighting has broken into spans. */
function stripTags(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

describe('notebookToHtml', () => {
  it('produces a whole document with the notebook named in it', async () => {
    const html = await notebookToHtml(notebook([cell({ source: 'x = 1' })]), {
      title,
      kernelDisplayName: 'Python 3 (ipykernel)',
    });

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>analysis.ipynb</title>');
    expect(html).toContain('Python 3 (ipykernel)');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  // Nothing may be fetched when the file is opened, so this looks for the four things that fetch
  // rather than for a URL: SVG and MathML both carry namespace URIs, which are names, not addresses.
  it('carries its own stylesheet and fetches nothing', async () => {
    const html = await notebookToHtml(
      notebook([
        cell({ cell_type: 'markdown', source: 'A formula $x^2$.' }),
        cell({
          source: 'draw()',
          outputs: [
            { output_type: 'display_data', data: { 'image/svg+xml': '<svg><circle/></svg>' } },
          ],
        }),
      ]),
      { title }
    );

    expect(html).toContain('<style>');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('@import');
    expect(html).not.toContain('url(');
  });

  it('writes the code with its prompt', async () => {
    const html = await notebookToHtml(
      notebook([cell({ source: 'import pandas', execution_count: 7 })]),
      { title }
    );

    expect(html).toContain('[7]');
    expect(html).toContain('import');
  });

  it('shows a cell that never ran as an empty prompt', async () => {
    const html = await notebookToHtml(notebook([cell({ source: 'x = 1' })]), { title });

    expect(html).toContain('[ ]');
  });

  it('renders a markdown cell as prose rather than as source', async () => {
    const html = await notebookToHtml(
      notebook([cell({ cell_type: 'markdown', source: '## Sensor drift' })]),
      { title }
    );

    expect(html).toContain('<h2>Sensor drift</h2>');
  });

  it('renders maths as MathML, so the file needs no font', async () => {
    const html = await notebookToHtml(
      notebook([cell({ cell_type: 'markdown', source: 'The value $x^2$ rises.' })]),
      { title }
    );

    expect(html).toContain('<math');
    // KaTeX's visual HTML copy is what needs its stylesheet and its five web fonts.
    expect(html).not.toContain('katex-html');
  });

  // A text/latex output goes through OutputBundles rather than through the cell, so it reaches KaTeX
  // by a different path — and that path is where the HTML copy leaked into the file once already.
  it('renders a LaTeX output as MathML too', async () => {
    const html = await notebookToHtml(
      notebook([
        cell({
          source: 'Math("x^2")',
          outputs: [{ output_type: 'execute_result', data: { 'text/latex': '$x^2$' } }],
        }),
      ]),
      { title }
    );

    expect(html).toContain('<math');
    expect(html).not.toContain('katex-html');
  });

  it('inlines an image output', async () => {
    const html = await notebookToHtml(
      notebook([
        cell({
          source: 'plot()',
          outputs: [{ output_type: 'display_data', data: { 'image/png': 'AAAB' } }],
        }),
      ]),
      { title }
    );

    expect(html).toContain('data:image/png;base64,AAAB');
  });

  it('keeps a stream output and its stderr tint', async () => {
    const html = await notebookToHtml(
      notebook([
        cell({
          source: 'warn()',
          outputs: [{ output_type: 'stream', name: 'stderr', text: 'careful\n' }],
        }),
      ]),
      { title }
    );

    expect(html).toContain('careful');
    expect(html).toContain('output-stderr');
  });

  it('keeps a traceback, and colours it through the ANSI classes', async () => {
    const html = await notebookToHtml(
      notebook([
        cell({
          outputs: [
            {
              output_type: 'error',
              ename: 'ValueError',
              evalue: 'bad window',
              traceback: ['[0;31mValueError[0m: bad window'],
            },
          ],
        }),
      ]),
      { title }
    );

    expect(html).toContain('ValueError');
    expect(html).toContain('ansi-red-fg');
    expect(html).not.toContain('');
  });

  it('strips a script out of an output, whoever produced it', async () => {
    const html = await notebookToHtml(
      notebook([
        cell({
          outputs: [
            {
              output_type: 'display_data',
              data: { 'text/html': '<div onclick="steal()">hi</div><script>steal()</script>' },
            },
          ],
        }),
      ]),
      { title }
    );

    expect(html).toContain('hi');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onclick');
  });

  it("says a widget is missing rather than dropping the cell's output", async () => {
    const html = await notebookToHtml(
      notebook([
        cell({
          outputs: [
            {
              output_type: 'display_data',
              data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'abc' } },
            },
          ],
        }),
      ]),
      { title }
    );

    expect(html).toContain('needs a running kernel');
  });

  it("falls back to a widget's own text when it has some", async () => {
    const html = await notebookToHtml(
      notebook([
        cell({
          outputs: [
            {
              output_type: 'display_data',
              data: {
                'application/vnd.jupyter.widget-view+json': { model_id: 'abc' },
                'text/plain': 'IntSlider(value=7)',
              },
            },
          ],
        }),
      ]),
      { title }
    );

    expect(html).toContain('IntSlider(value=7)');
    expect(html).not.toContain('needs a running kernel');
  });

  it('leaves the code out but keeps the outputs when asked for a report', async () => {
    const html = await notebookToHtml(
      notebook([
        cell({
          source: 'secret_token = "hunter2"',
          outputs: [{ output_type: 'stream', text: 'done\n' }],
        }),
      ]),
      { title, includeCode: false }
    );

    expect(html).not.toContain('hunter2');
    expect(html).toContain('done');
    expect(html).toContain('zx-outputs-only');
  });

  it('leaves the outputs out when asked to', async () => {
    const html = await notebookToHtml(
      notebook([cell({ source: 'x = 1', outputs: [{ output_type: 'stream', text: 'done\n' }] })]),
      { title, includeOutputs: false }
    );

    // The source is highlighted, so it reaches the file as spans rather than as one run of text.
    expect(stripTags(html)).toContain('x = 1');
    expect(html).not.toContain('done');
  });

  it('does not change the notebook it was given', async () => {
    const source = notebook([
      cell({
        outputs: [
          {
            output_type: 'display_data',
            data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'abc' } },
          },
        ],
      }),
    ]);
    const before = JSON.stringify(source);

    await notebookToHtml(source, { title });

    expect(JSON.stringify(source)).toBe(before);
  });
});
