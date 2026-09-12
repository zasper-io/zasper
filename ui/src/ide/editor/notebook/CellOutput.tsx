import { lazy, Suspense, useEffect, useRef } from 'react';
import { AnsiUp } from 'ansi_up';

import { ICell, ICellOutput } from '@/api';
import WidgetRenderer, { type WidgetSource } from '@/ide/widgets/WidgetRenderer';

import { hasMathDelimiters } from './mathDelimiters';
import PlotlyOutput from './PlotlyOutput';

// The boundary Cell.tsx keeps for markdown cells, for the same reason: katex and the markdown
// pipeline are the heaviest thing in the notebook, and an output only needs them when it is LaTeX.
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

/**
 * Renders an HTML output bundle and then re-executes any <script> it contains.
 * dangerouslySetInnerHTML alone will not run them, and some libraries (plotly,
 * bokeh) ship their output as markup plus a bootstrap script.
 */
const HTMLWithScripts = ({ html }: { html: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scripts = container.querySelectorAll('script');
    scripts.forEach((oldScript) => {
      const newScript = document.createElement('script');
      if (oldScript.src) {
        newScript.src = oldScript.src;
      } else {
        newScript.text = oldScript.textContent || '';
      }
      Array.from(oldScript.attributes).forEach((attr) =>
        newScript.setAttribute(attr.name, attr.value)
      );
      oldScript.parentNode?.replaceChild(newScript, oldScript);
    });
  }, [html]);

  return <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />;
};

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
const LatexOutput = ({ latex }: { latex: string }) => (
  <Suspense fallback={null}>
    <MarkdownRenderer source={hasMathDelimiters(latex) ? latex : `$$${latex}$$`} />
  </Suspense>
);

interface OutputBundlesProps {
  outputs: ICellOutput[];
  widgets: WidgetSource | null;
}

/**
 * A list of output bundles, each dispatched on the richest representation the kernel sent, in
 * Jupyter's preference order: widget, plotly figure, HTML, LaTeX, SVG, image, then plain text.
 *
 * Exported because a cell is not the only place outputs are shown: ipywidgets' Output widget holds
 * some of its own, and renders them through here so that they look like every other output.
 */
export const OutputBundles = ({ outputs, widgets }: OutputBundlesProps) => {
  const ansi_up = new AnsiUp();
  // Classes rather than `style="color:rgb(187,0,0)"`, which is what this emits by default: an escape
  // code the kernel sent used to arrive as a literal colour from a 16-colour terminal palette that no
  // theme could reach. The map from `.ansi-*-fg` to --z-ansi-* is in NotebookEditor.scss. Bold, faint,
  // italic and underline are still inline, and so is 24-bit colour, which is a colour rather than a slot.
  ansi_up.use_classes = true;

  return (
    <>
      {outputs.map((output: ICellOutput, index: number) => {
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

        if (text) {
          const textHtml = ansi_up.ansi_to_html(text);
          // stderr is tinted, stdout is not. Both are `stream` outputs and the only thing that tells
          // them apart is `name`, which the kernel always sends and this app used to throw away along
          // with the whole stderr message — so warnings and tqdm bars showed as nothing at all.
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
            'text/latex': latexContent,
            'image/svg+xml': svgContent,
            'image/png': pngContent,
            'image/jpeg': jpegContent,
            'text/plain': textPlainData,
            'application/vnd.jupyter.widget-view+json': widgetData,
            'application/vnd.plotly.v1+json': plotlyFigure,
            'application/json': jsonContent,
          } = outputData;

          if (widgetData) {
            return <WidgetRenderer key={index} modelId={widgetData.model_id} widgets={widgets} />;
          }

          // Ahead of text/html because a plotly renderer that sends both sends markup that loads
          // plotly.js from a CDN, and the figure is already here.
          if (plotlyFigure) {
            return <PlotlyOutput key={index} figure={plotlyFigure} />;
          }

          if (htmlContent) {
            return <HTMLWithScripts key={index} html={htmlContent} />;
          }

          if (latexContent) {
            return <LatexOutput key={index} latex={latexContent} />;
          }

          // Inlined rather than wrapped in an `<img>` data URL, which is what Jupyter does: an SVG
          // that sizes itself to its container cannot do that inside an `<img>`. It is the kernel's
          // markup on the same terms as the text/html above it.
          if (svgContent) {
            return (
              <div
                key={index}
                className="output-svg"
                dangerouslySetInnerHTML={{ __html: svgContent }}
              />
            );
          }

          if (pngContent) {
            return <ImageOutput key={index} mime="image/png" data={pngContent} />;
          }

          if (jpegContent) {
            return <ImageOutput key={index} mime="image/jpeg" data={jpegContent} />;
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

        // Nothing here can show it, so say which representations arrived rather than printing one: an
        // unrendered bundle runs to tens of kilobytes of JSON, and a wall of that in a cell is what a
        // missing renderer used to look like.
        const arrived = outputData ? Object.keys(outputData).join(', ') : output.output_type;
        return <p key={index}>This output cannot be displayed ({arrived ?? 'unknown type'}).</p>;
      })}
    </>
  );
};

interface CellOutputProps {
  data: ICell;
  widgets: WidgetSource | null;
}

/** The output area of a single cell. */
const CellOutput = ({ data, widgets }: CellOutputProps) => {
  const outputs = data?.outputs;
  if (!outputs || outputs.length === 0) {
    return null;
  }
  return <OutputBundles outputs={outputs} widgets={widgets} />;
};

export default CellOutput;
