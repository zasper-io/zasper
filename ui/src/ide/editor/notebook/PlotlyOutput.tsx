import { useEffect, useRef, useState } from 'react';
import type * as Plotly from 'plotly.js-dist-min';

type PlotlyModule = typeof import('plotly.js-dist-min');

/**
 * A figure as an `application/vnd.plotly.v1+json` output carries it: plotly.js' own arguments, less
 * the element to draw into. `config` is usually absent — plotly.py sends one only for a figure that
 * was given one.
 */
export interface IPlotlyFigure {
  data?: Plotly.Data[];
  layout?: Partial<Plotly.Layout>;
  config?: Partial<Plotly.Config>;
}

/**
 * plotly.js, which is a megabyte gzipped and so is fetched only once a notebook has a figure to draw.
 *
 * It is one UMD file, so what an `import` hands back depends on who bundled it: Vite puts the
 * CommonJS exports under `default`, and a bundler that read the named exports would not.
 */
async function loadPlotly(): Promise<PlotlyModule> {
  const loaded = await import('plotly.js-dist-min');
  return (loaded as { default?: PlotlyModule }).default ?? loaded;
}

/**
 * A plotly figure in a cell's output.
 *
 * plotly's default renderer in a Jupyter kernel is `plotly_mimetype`, which publishes the figure as
 * JSON under its own mime type and nothing else — no HTML, no image. So this is the only thing that
 * can draw it, and without it a `fig.show()` puts ten kilobytes of JSON in the cell.
 */
const PlotlyOutput = ({ figure }: { figure: IPlotlyFigure }) => {
  const host = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    setFailure(undefined);

    let cancelled = false;
    // Held for the cleanup: a plot left behind keeps its resize listener, and one drawn on a canvas
    // keeps a WebGL context, of which a browser grants only so many.
    let drawn: { plotly: PlotlyModule; el: HTMLDivElement } | undefined;

    void (async () => {
      try {
        const plotly = await loadPlotly();
        if (cancelled || !host.current) {
          return;
        }
        drawn = { plotly, el: host.current };
        await plotly.newPlot(host.current, figure.data ?? [], figure.layout ?? {}, {
          // A figure with no width of its own should follow the output area, which is as wide as the
          // window. The figure's own config still wins: it may have asked for something else.
          responsive: true,
          ...figure.config,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Could not draw the plotly figure:', error);
        setFailure('This plotly figure could not be drawn; the browser console has the reason.');
      }
    })();

    return () => {
      cancelled = true;
      drawn?.plotly.purge(drawn.el);
    };
  }, [figure]);

  return (
    <>
      {failure && <p>{failure}</p>}
      {/*
        The white plate the figure sits on, and it has to be a wrapper rather than a class on the
        graph div itself. plotly's autosize reads `getComputedStyle(gd).height` and falls back to its
        450px default only when that comes out falsy — which for an unsized div is `0px`. Any padding
        on the graph div therefore *is* the figure's height: 4px either side drew every plot 8px tall.
      */}
      <div className="output-figure">
        {/* plotly.js owns this element's contents, so nothing React renders may live inside it. */}
        <div ref={host} />
      </div>
    </>
  );
};

export default PlotlyOutput;
