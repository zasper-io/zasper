import { ComponentType, createContext, lazy, Suspense, useContext, useMemo } from 'react';
import { AnsiUp } from 'ansi_up';
import DOMPurify from 'dompurify';

import { NotebookCell, NotebookOutput, OutputTable, TABLE_MIME } from '@/api';
import { SQL_MIME, SqlActions, SqlError, SqlProvenance, SqlRunInfo } from './SqlOutput';
import WidgetRenderer, { type WidgetSource } from '@/ide/widgets/WidgetRenderer';

import type { MarkdownRendererProps } from './MarkdownRenderer';

import DataFrameOutput, { OutputTables } from './DataFrameOutput';
import { hasMathDelimiters } from './mathDelimiters';
import { isProducedHere } from './outputTrust';
import PlotlyOutput from './PlotlyOutput';
import { SandboxContext, SandboxedOutput } from './SandboxedOutput';

// The boundary Cell.tsx keeps for markdown cells, for the same reason: katex and the markdown
// pipeline are the heaviest thing in the notebook, and an output only needs them when it is LaTeX.
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

/**
 * Which markdown renderer a LaTeX output is drawn with. The lazy one on screen, where suspending costs
 * nothing; the eagerly imported one for the HTML export (export/toHtml.tsx), which renders to a string
 * in a single pass and so cannot wait for a chunk to arrive. Nothing else has any business replacing it.
 */
export const MarkdownRendererContext =
  createContext<ComponentType<MarkdownRendererProps>>(MarkdownRenderer);

// What DOMPurify takes out that would have run: the elements that run or load code, and below,
// event handlers and `javascript:` addresses.
const RUNNABLE = new Set(['SCRIPT', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'BASE', 'META', 'LINK']);

function runnable(removed: (typeof DOMPurify.removed)[number]): boolean {
  if ('element' in removed) {
    return (
      removed.element instanceof Element && RUNNABLE.has(removed.element.nodeName.toUpperCase())
    );
  }
  const { name, value } = removed.attribute ?? { name: '', value: '' };
  return /^on/i.test(name) || name === 'srcdoc' || /^\s*javascript:/i.test(value);
}

/**
 * Markup with anything that could run taken out, and whether any of it was there to take: a script, a
 * frame, an event handler, a `javascript:` link. Not what DOMPurify drops for being unknown, such as
 * the `scoped` on a DataFrame's `<style>`, which would otherwise send every table to a frame.
 */
function sanitise(markup: string, config: Parameters<typeof DOMPurify.sanitize>[1]) {
  const clean = DOMPurify.sanitize(markup, config) as string;
  return { clean, scripted: DOMPurify.removed.some(runnable) };
}

// FORCE_BODY keeps a leading <style>, which is how a DataFrame's HTML starts.
const sanitiseHtml = (html: string) => sanitise(html, { FORCE_BODY: true });
const sanitiseSvg = (svg: string) =>
  sanitise(svg, { USE_PROFILES: { svg: true, svgFilters: true } });

/**
 * Markup from a kernel or a file, shown in the page once nothing in it can run. What a running kernel
 * sent and needs its scripts, as Bokeh's does, runs in a sandboxed frame instead, never in the page,
 * where it would act as whoever is looking. What a notebook file brought is only ever sanitised: it
 * was chosen by whoever wrote the file.
 */
const MarkupOutput = ({
  markup,
  trusted,
  sanitiser,
  className,
}: {
  markup: string;
  trusted: boolean;
  sanitiser: (markup: string) => { clean: string; scripted: boolean };
  className?: string;
}) => {
  const sandbox = useContext(SandboxContext);
  const { clean, scripted } = useMemo(() => sanitiser(markup), [markup, sanitiser]);
  if (trusted && scripted && sandbox) {
    return <SandboxedOutput markup={markup} />;
  }
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
};

const HTMLOutput = ({ html, trusted }: { html: string; trusted: boolean }) => (
  <MarkupOutput markup={html} trusted={trusted} sanitiser={sanitiseHtml} />
);

/** A base64 image bundle. png and jpeg differ only in the mime type the data URL names. */
const ImageOutput = ({ mime, data }: { mime: string; data: string }) => (
  <div>
    <img src={`data:${mime};base64,${data}`} alt="cell output" />
  </div>
);

/**
 * A `text/latex` bundle — SymPy under `init_printing()`, and IPython's `Latex` and `Math`.
 *
 * Rendered through the markdown pipeline, which already carries KaTeX for markdown cells, rather
 * than a second maths renderer. A payload usually brings its own `$$…$$`; one that does not, such as
 * a bare `\begin{align}`, is wrapped, because remark-math reads nothing else and would otherwise
 * print the source.
 */
const LatexOutput = ({ latex }: { latex: string }) => {
  const Renderer = useContext(MarkdownRendererContext);
  return (
    <Suspense fallback={null}>
      <Renderer source={hasMathDelimiters(latex) ? latex : `$$${latex}$$`} />
    </Suspense>
  );
};

/**
 * A `text/markdown` bundle, which xeus kernels, Deno and IJulia send, sometimes with no `text/plain` beside
 * it. The markdown cells' renderer, which sanitises what it is given, so a notebook from elsewhere is safe.
 */
const MarkdownOutput = ({ source }: { source: string }) => {
  const Renderer = useContext(MarkdownRendererContext);
  return (
    <Suspense fallback={null}>
      <div className="output-markdown">
        <Renderer source={source} />
      </div>
    </Suspense>
  );
};

/** An `application/pdf` bundle, in the browser's own viewer, which keeps a PDF's scripts to itself. */
const PdfOutput = ({ data }: { data: string }) => (
  <object
    className="output-pdf"
    data={`data:application/pdf;base64,${data}`}
    type="application/pdf"
    aria-label="PDF output"
  />
);

interface OutputBundlesProps {
  outputs: NotebookOutput[];
  widgets: WidgetSource | null;
  /** Only a live cell passes this: an export, or an Output widget, shows pandas' table as it is. */
  tables?: OutputTables;
  /** A SQL cell's: its outputs can run it again and install a missing driver. */
  sql?: SqlActions;
}

/**
 * A list of output bundles, each dispatched on the richest representation the kernel sent, in
 * Jupyter's preference order: widget, plotly figure, HTML, Markdown, LaTeX, SVG, image, PDF, then plain
 * text.
 *
 * Exported because a cell is not the only place outputs are shown: ipywidgets' Output widget holds
 * some of its own, and renders them through here so that they look like every other output.
 */
export const OutputBundles = ({ outputs, widgets, tables, sql }: OutputBundlesProps) => {
  const ansi_up = new AnsiUp();
  // Classes rather than the `style="color:rgb(187,0,0)"` this emits by default, which would bake a
  // 16-colour terminal palette into the HTML where no theme could reach it. The map from `.ansi-*-fg`
  // to --z-ansi-* is in NotebookEditor.scss. Bold, faint, italic, underline and 24-bit colour stay
  // inline: a colour rather than a slot.
  ansi_up.use_classes = true;

  return (
    <>
      {outputs.map((output: NotebookOutput, index: number) => {
        if (output.output_type === 'error' && output.ename === 'SqlError') {
          return <SqlError key={index} message={String(output.evalue)} actions={sql} />;
        }
        if (output.output_type === 'error') {
          const { ename, evalue, traceback } = output;
          const tracebackHtml = ansi_up.ansi_to_html(traceback ? traceback.join('\n') : '');

          return (
            <div key={index} className="output-error">
              <span className="ename">
                {ename}: {evalue}
              </span>
              <pre>
                <div dangerouslySetInnerHTML={{ __html: tracebackHtml }} />
              </pre>
            </div>
          );
        }

        const { text, 'text/plain': textPlain, data: outputData } = output;
        const trusted = isProducedHere(output);

        if (text) {
          const textHtml = ansi_up.ansi_to_html(text);
          // stderr is tinted, stdout is not. Both are `stream` outputs, and `name` is the only thing
          // that tells them apart — it carries the warnings, the logging module and every tqdm bar.
          const streamClass = output.name === 'stderr' ? 'output-stderr' : undefined;
          return (
            <pre key={index} className={streamClass}>
              <div dangerouslySetInnerHTML={{ __html: textHtml }} />
            </pre>
          );
        }

        if (textPlain) {
          const textPlainHtml = ansi_up.ansi_to_html(textPlain);
          return (
            <pre key={index}>
              <div dangerouslySetInnerHTML={{ __html: textPlainHtml }} />
            </pre>
          );
        }

        if (outputData) {
          const {
            'text/html': htmlContent,
            'text/markdown': markdownContent,
            'text/latex': latexContent,
            'image/svg+xml': svgContent,
            'image/png': pngContent,
            'image/jpeg': jpegContent,
            'image/gif': gifContent,
            'image/webp': webpContent,
            'application/pdf': pdfContent,
            'text/plain': textPlainData,
            'application/vnd.jupyter.widget-view+json': widgetData,
            'application/vnd.plotly.v1+json': plotlyFigure,
            'application/json': jsonContent,
          } = outputData;

          if (widgetData) {
            return <WidgetRenderer key={index} modelId={widgetData.model_id} widgets={widgets} />;
          }

          const sqlRun = outputData[SQL_MIME] as SqlRunInfo | undefined;
          if (sqlRun) {
            // Keyed by the run too, so a count Load all made forgets itself when the cell runs again.
            return <SqlProvenance key={`${index}:${sqlRun.ran_at}`} info={sqlRun} actions={sql} />;
          }

          const table = outputData[TABLE_MIME] as OutputTable | undefined;
          if (tables && table?.id) {
            const fallback = htmlContent ? (
              <HTMLOutput html={htmlContent} trusted={trusted} />
            ) : (
              <pre>{textPlainData}</pre>
            );
            return (
              <DataFrameOutput key={index} table={table} tables={tables} fallback={fallback} />
            );
          }

          // Ahead of text/html because a plotly renderer that sends both sends markup that loads
          // plotly.js from a CDN, and the figure is already here.
          if (plotlyFigure) {
            return <PlotlyOutput key={index} figure={plotlyFigure} />;
          }

          if (htmlContent) {
            return <HTMLOutput key={index} html={htmlContent} trusted={trusted} />;
          }

          if (markdownContent) {
            return <MarkdownOutput key={index} source={markdownContent} />;
          }

          if (latexContent) {
            return <LatexOutput key={index} latex={latexContent} />;
          }

          // Inlined rather than wrapped in an `<img>` data URL, which is what Jupyter does: an SVG
          // that sizes itself to its container cannot do that inside an `<img>`. It is the kernel's
          // markup on the same terms as the text/html above it.
          if (svgContent) {
            return (
              <MarkupOutput
                key={index}
                markup={svgContent}
                trusted={trusted}
                sanitiser={sanitiseSvg}
                className="output-svg"
              />
            );
          }

          if (pngContent) {
            return <ImageOutput key={index} mime="image/png" data={pngContent} />;
          }

          if (jpegContent) {
            return <ImageOutput key={index} mime="image/jpeg" data={jpegContent} />;
          }

          if (gifContent) {
            return <ImageOutput key={index} mime="image/gif" data={gifContent} />;
          }

          if (webpContent) {
            return <ImageOutput key={index} mime="image/webp" data={webpContent} />;
          }

          if (pdfContent) {
            return <PdfOutput key={index} data={pdfContent} />;
          }

          if (textPlainData) {
            const textPlainDataHtml = ansi_up.ansi_to_html(textPlainData);
            return (
              <pre key={index}>
                <div dangerouslySetInnerHTML={{ __html: textPlainDataHtml }} />
              </pre>
            );
          }

          if (jsonContent) {
            return <pre key={index}>{JSON.stringify(jsonContent, null, 2)}</pre>;
          }
        }

        // Nothing here can show it, so name the representations that arrived rather than printing one:
        // an unrendered bundle runs to tens of kilobytes of JSON.
        const arrived = outputData ? Object.keys(outputData).join(', ') : output.output_type;
        return <p key={index}>This output cannot be displayed ({arrived ?? 'unknown type'}).</p>;
      })}
    </>
  );
};

interface CellOutputProps {
  data: NotebookCell;
  widgets: WidgetSource | null;
  tables?: OutputTables;
  sql?: SqlActions;
}

/** The output area of a single cell. */
const CellOutput = ({ data, widgets, tables, sql }: CellOutputProps) => {
  const outputs = data?.outputs;
  if (!outputs || outputs.length === 0) {
    return null;
  }
  return <OutputBundles outputs={outputs} widgets={widgets} tables={tables} sql={sql} />;
};

export default CellOutput;
