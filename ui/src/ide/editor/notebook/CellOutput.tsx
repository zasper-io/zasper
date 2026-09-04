import { useEffect, useRef } from 'react';
import { AnsiUp } from 'ansi_up';

import { ICell, ICellOutput } from '@/api';
import WidgetRenderer, { type WidgetSource } from '@/ide/widgets/WidgetRenderer';

import PlotlyOutput from './PlotlyOutput';

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

interface OutputBundlesProps {
  outputs: ICellOutput[];
  widgets: WidgetSource | null;
}

/**
 * A list of output bundles, each dispatched on the richest representation the kernel sent, in
 * Jupyter's preference order: widget, plotly figure, HTML, image, then plain text.
 *
 * Exported because a cell is not the only place outputs are shown: ipywidgets' Output widget holds
 * some of its own, and renders them through here so that they look like every other output.
 */
export const OutputBundles = ({ outputs, widgets }: OutputBundlesProps) => {
  const ansi_up = new AnsiUp();

  return (
    <>
      {outputs.map((output: ICellOutput, index: number) => {
        if (output.output_type === 'error') {
          const { ename, evalue, traceback } = output;
          const tracebackHtml = ansi_up.ansi_to_html(traceback ? traceback.join('\n') : '');

          return (
            <div key={index}>
              <h6>
                {ename}: {evalue}
              </h6>
              <pre>
                <div dangerouslySetInnerHTML={{ __html: tracebackHtml }} />
              </pre>
            </div>
          );
        }

        const { text, 'text/plain': textPlain, data: outputData } = output;

        if (text) {
          const textHtml = ansi_up.ansi_to_html(text);
          return (
            <pre key={index}>
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
            'image/png': imageContent,
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

          if (imageContent) {
            const blob = `data:image/png;base64,${imageContent}`;
            return (
              <div key={index}>
                <img src={blob} alt="cell output" />
              </div>
            );
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
