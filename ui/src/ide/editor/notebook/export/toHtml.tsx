import { renderToStaticMarkup } from 'react-dom/server';
import DOMPurify from 'dompurify';

import { NotebookCell, NotebookModel, NotebookOutput } from '@/api';

import { MarkdownRendererContext, OutputBundles } from '../CellOutput';
import MarkdownRenderer, { type MarkdownRendererProps } from '../MarkdownRenderer';
import { cellSource, joinOutputLines, notebookLanguage } from './exportFormats';
import { escapeHtml, highlightSource } from './exportHighlight';
import { exportStylesheet } from './exportStyles';
import { readExportPalette } from './exportTheme';

/*
A notebook as one static HTML page — marimo's `export html`, and the format you send to someone who has
never installed Jupyter.

The whole point of doing this in the browser is that the renderers are already here. A cell's outputs go
through `OutputBundles`, the same component drawing them on screen, so the export and the window cannot
disagree about which representation of an output wins or how a traceback is coloured. Prose goes through
`MarkdownRenderer`, so a formula and a table come out as they look. What is produced is a string, in one
pass, with `renderToStaticMarkup`.

One pass is the constraint that shapes the rest of this file. A static render never runs an effect and
cannot wait for a chunk, so the three things in a notebook that need one are dealt with *before* the
render rather than during it:

  - **Markdown** is behind `React.lazy` on screen. `MarkdownRendererContext` hands the static render the
    eagerly imported one. That is also why this module is only ever reached through a dynamic import —
    importing it eagerly would drag KaTeX and the markdown pipeline back into the main bundle.
  - **Plotly** draws itself imperatively into a div. Its figures become still PNGs first. An exported
    page has no JavaScript in it, so there was never an interactive version to lose.
  - **Widgets** need a live kernel behind them. They fall back to their own `text/plain`, because Zasper
    does not write `application/vnd.jupyter.widget-state+json` into the file — see the open question in
    todos/data-apps.md. When that lands, a widget could be exported properly.

And one pass is also why every output is sanitised. `outputTrust.ts` is a WeakSet keyed on object
identity: it cannot survive being cloned, let alone serialised, so nothing in an export is trusted and
no script reaches the file. That is the right answer anyway — this page is going to be opened by someone
who was not there when the code ran.
*/

/**
 * Markdown for a file rather than for the screen: MathML only, so a formula needs neither KaTeX's
 * stylesheet nor its five web fonts, neither of which an export can ship or link to.
 *
 * Used for markdown cells *and* given to `MarkdownRendererContext`, which is what a `text/latex`
 * output is drawn through. Missing the second is how the first version of this shipped files carrying
 * KaTeX's visual HTML copy with nothing to style it — every formula rendered twice, once unreadably.
 */
const StaticMarkdown = (props: MarkdownRendererProps) => (
  <MarkdownRenderer {...props} katexOutput="mathml" />
);

const PLOTLY_MIME = 'application/vnd.plotly.v1+json';
const WIDGET_MIME = 'application/vnd.jupyter.widget-view+json';

export interface HtmlExportOptions {
  /** The document's title and heading — the notebook's file name. */
  title: string;
  /** Named under the title, when the notebook says which kernel it ran on. */
  kernelDisplayName?: string;
  /** marimo's `--no-include-code`: a report rather than a record. */
  includeCode?: boolean;
  includeOutputs?: boolean;
  /** The attached kernel's language, which decides how code cells are highlighted. */
  language?: string;
}

/** A figure as a still image, or null when Plotly will not draw it. */
async function plotlyToPng(figure: { data?: unknown; layout?: unknown }): Promise<string | null> {
  try {
    const Plotly = await import('plotly.js-dist-min');
    const dataUrl = await Plotly.toImage(
      { data: (figure.data ?? []) as never, layout: (figure.layout ?? {}) as never },
      { format: 'png', width: 800, height: 500 }
    );
    const comma = dataUrl.indexOf(',');
    return comma === -1 ? null : dataUrl.slice(comma + 1);
  } catch {
    return null;
  }
}

/**
 * One output with everything a live page provides taken out of it.
 *
 * The bundle is copied rather than edited: these objects are the notebook the editor is still holding,
 * and an export must not change what is on screen or what a save would write.
 */
async function staticiseOutput(raw: NotebookOutput): Promise<NotebookOutput> {
  const output = joinOutputLines(raw);
  const data = output.data;
  if (!data || (data[PLOTLY_MIME] === undefined && data[WIDGET_MIME] === undefined)) {
    return output;
  }

  const next: Record<string, unknown> = { ...data };

  if (next[PLOTLY_MIME] !== undefined) {
    const png = await plotlyToPng(next[PLOTLY_MIME] as { data?: unknown; layout?: unknown });
    delete next[PLOTLY_MIME];
    if (png !== null) {
      // Ahead of any text/plain the same bundle carries, which is what OutputBundles would otherwise
      // fall through to — a figure that came out as "Figure(640x480)" is not an export of a figure.
      next['image/png'] = png;
    }
  }

  if (next[WIDGET_MIME] !== undefined) {
    delete next[WIDGET_MIME];
    if (Object.keys(next).length === 0) {
      next['text/plain'] = 'This widget needs a running kernel and is not in the export.';
    }
  }

  return { ...output, data: next };
}

async function staticiseCell(cell: NotebookCell): Promise<NotebookOutput[]> {
  return Promise.all((cell.outputs ?? []).map(staticiseOutput));
}

/** A cell with everything the render needs already resolved: highlighting is async, rendering is not. */
interface PreparedCell {
  cell: NotebookCell;
  /** Code cells: the source, highlighted, as markup. */
  sourceHtml: string;
  outputs: NotebookOutput[];
}

async function prepare(
  notebook: NotebookModel,
  language: string,
  includeOutputs: boolean
): Promise<PreparedCell[]> {
  return Promise.all(
    notebook.cells.map(async (cell) => ({
      cell,
      sourceHtml:
        cell.cell_type === 'code'
          ? await highlightSource(cellSource(cell.source), language)
          : escapeHtml(cellSource(cell.source)),
      outputs: includeOutputs ? await staticiseCell(cell) : [],
    }))
  );
}

/** `[7]`, `[ ]` for a cell that has not run, `[*]` for one that was still running when this was taken. */
function promptLabel(cell: NotebookCell): string {
  const count = cell.execution_count;
  if (count === -1) {
    return '[*]';
  }
  return typeof count === 'number' ? `[${count}]` : '[ ]';
}

const ExportedCell = ({
  prepared,
  includeCode,
}: {
  prepared: PreparedCell;
  includeCode: boolean;
}) => {
  const { cell, sourceHtml, outputs } = prepared;
  const source = cellSource(cell.source);

  if (cell.cell_type === 'markdown') {
    return source.trim() === '' ? null : <StaticMarkdown source={source} />;
  }

  if (cell.cell_type === 'raw') {
    // Not highlighted and not rendered: a raw cell is text meant for a converter that is not this one.
    return source.trim() === '' ? null : (
      <div className="zx-cell">
        <span className="zx-prompt" />
        <pre className="zx-source" dangerouslySetInnerHTML={{ __html: sourceHtml }} />
      </div>
    );
  }

  const hasOutputs = outputs.length > 0;
  const showCode = includeCode && source.trim() !== '';
  if (!showCode && !hasOutputs) {
    return null;
  }

  return (
    <>
      {showCode && (
        <div className="zx-cell">
          <span className="zx-prompt">{promptLabel(cell)}</span>
          <pre className="zx-source" dangerouslySetInnerHTML={{ __html: sourceHtml }} />
        </div>
      )}
      {hasOutputs && (
        <div className="zx-output">
          <OutputBundles outputs={outputs} widgets={null} />
        </div>
      )}
    </>
  );
};

const ExportedNotebook = ({
  cells,
  options,
}: {
  cells: PreparedCell[];
  options: Required<Pick<HtmlExportOptions, 'title' | 'includeCode'>> & { kernel?: string };
}) => (
  // The eager renderer, for the LaTeX outputs inside OutputBundles: a static render cannot suspend.
  <MarkdownRendererContext.Provider value={StaticMarkdown}>
    <main className={options.includeCode ? 'zx-page' : 'zx-page zx-outputs-only'}>
      <h1 className="zx-title">{options.title}</h1>
      <p className="zx-meta">
        {options.kernel === undefined
          ? 'Exported from Zasper'
          : `Exported from Zasper · ${options.kernel}`}
      </p>
      {cells.map((prepared) => (
        <ExportedCell
          key={prepared.cell.id}
          prepared={prepared}
          includeCode={options.includeCode}
        />
      ))}
    </main>
  </MarkdownRendererContext.Provider>
);

/**
 * The whole notebook as one self-contained HTML document.
 *
 * Asynchronous because of the two things that cannot be resolved during a render — a grammar that has to
 * be fetched, and a figure that has to be drawn — not because the render itself is.
 */
export async function notebookToHtml(
  notebook: NotebookModel,
  options: HtmlExportOptions
): Promise<string> {
  const includeCode = options.includeCode ?? true;
  const includeOutputs = options.includeOutputs ?? true;
  const language = notebookLanguage(notebook, options.language);

  const cells = await prepare(notebook, language, includeOutputs);

  const body = renderToStaticMarkup(
    <ExportedNotebook
      cells={cells}
      options={{ title: options.title, includeCode, kernel: options.kernelDisplayName }}
    />
  );

  // FORCE_BODY keeps a leading <style>, which is how a DataFrame's HTML starts — the same reason
  // CellOutput passes it. Scripts and event handlers go, whoever produced them.
  const safeBody = DOMPurify.sanitize(body, { FORCE_BODY: true, FORBID_TAGS: ['script'] });

  const stylesheet = exportStylesheet(readExportPalette());

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="Zasper">',
    `<title>${escapeHtml(options.title)}</title>`,
    `<style>\n${stylesheet}\n</style>`,
    '</head>',
    '<body>',
    safeBody,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
