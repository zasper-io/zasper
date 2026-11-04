// Which representation of an output bundle is shown, for the types a kernel sends as something
// other than text. The bundles below are the shapes IPython's `display()` actually emits.
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NotebookOutput } from '@/api';

import { OutputBundles } from './CellOutput';
import { markProducedHere } from './outputTrust';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUg==';

// A script runs in jsdom's own window, not the test's `window`, so it marks the document they share.
const ran = (mark: string) => document.body.hasAttribute(`data-ran-${mark}`);

/** An output as it arrives in a notebook file. */
function show(data: Record<string, unknown>) {
  const outputs = [{ output_type: 'display_data', data }] as NotebookOutput[];
  return render(<OutputBundles outputs={outputs} widgets={null} />);
}

/** An output a running kernel has just sent. */
function showFromKernel(data: Record<string, unknown>) {
  const outputs = [markProducedHere({ output_type: 'display_data', data } as NotebookOutput)];
  return render(<OutputBundles outputs={outputs} widgets={null} />);
}

describe('OutputBundles from a notebook file', () => {
  it('drops the scripts in text/html rather than running them', () => {
    const { container } = show({
      'text/html': "<b>kept</b><script>document.body.setAttribute('data-ran-file', '')</script>",
    });

    expect(container.querySelector('b')).not.toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(ran('file')).toBe(false);
  });

  it('drops a same-origin iframe from text/html', () => {
    const { container } = show({
      'text/html': '<iframe srcdoc="<script>parent.ranFromFile = true</script>"></iframe>',
    });

    expect(container.querySelector('iframe')).toBeNull();
  });

  // A DataFrame's HTML opens with a scoped style, which must survive.
  it('keeps the table and style a DataFrame renders as', () => {
    const { container } = show({
      'text/html':
        '<style scoped>th { text-align: right; }</style><table><tr><th>a</th></tr></table>',
    });

    expect(container.querySelector('style')).not.toBeNull();
    expect(container.querySelector('table th')).not.toBeNull();
  });

  it('drops event handlers from image/svg+xml', () => {
    const { container } = show({
      'image/svg+xml':
        '<svg xmlns="http://www.w3.org/2000/svg" onload="window.ranFromFile = true"><circle r="4" /></svg>',
    });

    expect(container.querySelector('.output-svg circle')).not.toBeNull();
    expect(container.querySelector('[onload]')).toBeNull();
  });
});

describe('OutputBundles from a running kernel', () => {
  // Bokeh and similar libraries ship markup plus a bootstrap script. It runs, but in a frame whose
  // origin is no one's: in the page, it would act as whoever is looking at the notebook.
  it('runs the scripts in text/html in a sandboxed frame, not in the page', () => {
    const script = "<script>document.body.setAttribute('data-ran-kernel', '')</script>";
    const { container } = showFromKernel({ 'text/html': `<div id="plot"></div>${script}` });

    const frame = container.querySelector('iframe.output-sandbox');
    expect(frame).not.toBeNull();
    const sandbox = frame?.getAttribute('sandbox')?.split(' ');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(frame?.getAttribute('srcdoc')).toContain(script);
    expect(container.querySelector('script')).toBeNull();
    expect(ran('kernel')).toBe(false);
  });

  it('runs an event handler in image/svg+xml in a sandboxed frame too', () => {
    const { container } = showFromKernel({
      'image/svg+xml':
        '<svg xmlns="http://www.w3.org/2000/svg" onload="window.ranFromKernel = true"><circle r="4" /></svg>',
    });

    expect(container.querySelector('iframe.output-sandbox')?.getAttribute('srcdoc')).toContain(
      'onload'
    );
    expect(container.querySelector('[onload]')).toBeNull();
  });

  // A DataFrame, or any markup with nothing to run, stays in the page, where the notebook's styles reach it.
  it('shows markup with nothing to run in the page', () => {
    const { container } = showFromKernel({
      'text/html':
        '<style scoped>th { text-align: right; }</style><table class="dataframe"><tr><th>a</th></tr></table>',
    });

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('table.dataframe th')).not.toBeNull();
  });

  it('takes the frame’s height from the frame alone', () => {
    const { container } = showFromKernel({ 'text/html': '<script>1</script>' });
    const frame = container.querySelector('iframe.output-sandbox') as HTMLIFrameElement;

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { zasperOutputHeight: 9999 }, source: window })
      );
    });
    expect(frame.style.height).toBe('0px');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { zasperOutputHeight: 120.4 },
          source: frame.contentWindow,
        })
      );
    });
    expect(frame.style.height).toBe('121px');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { zasperOutputHeight: 1e9 },
          source: frame.contentWindow,
        })
      );
    });
    expect(frame.style.height).toBe('4000px');
  });
});

describe('OutputBundles', () => {
  it('renders image/png as an image', () => {
    show({ 'image/png': PIXEL, 'text/plain': '<IPython.core.display.Image object>' });

    expect(screen.getByAltText('Image output')).toHaveAttribute(
      'src',
      `data:image/png;base64,${PIXEL}`
    );
  });

  it("describes an image by its text/plain, when that says more than the object's class", () => {
    show({ 'image/png': PIXEL, 'text/plain': '<Figure size 640x480 with 1 Axes>' });

    expect(screen.getByRole('img')).toHaveAccessibleName('<Figure size 640x480 with 1 Axes>');
  });

  it('renders image/jpeg as an image', () => {
    show({ 'image/jpeg': PIXEL, 'text/plain': '<IPython.core.display.Image object>' });

    expect(screen.getByAltText('Image output')).toHaveAttribute(
      'src',
      `data:image/jpeg;base64,${PIXEL}`
    );
  });

  // Inline, not an <img src="data:…">, so an SVG that sizes itself to its container still can.
  it('inlines image/svg+xml as markup', () => {
    const { container } = show({
      'image/svg+xml': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" /></svg>',
      'text/plain': '<IPython.core.display.SVG object>',
    });

    expect(container.querySelector('.output-svg > svg > circle')).not.toBeNull();
  });

  it('renders text/latex through KaTeX', async () => {
    const { container } = show({
      'text/latex': '$$ e^{i\\pi} + 1 = 0 $$',
      'text/plain': '<IPython.core.display.Latex object>',
    });

    // The renderer is behind React.lazy, so the formula arrives a tick later.
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
  });

  // SymPy sends `$…$`, but a hand-written Latex() need not; without the wrap remark-math reads this
  // as prose and prints the source.
  it('renders a text/latex payload that carries no delimiters', async () => {
    const { container } = show({ 'text/latex': '\\frac{1}{2}' });

    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
  });

  // xeus kernels, Deno and IJulia send markdown, sometimes with nothing beside it.
  it('renders text/markdown', async () => {
    const { container } = show({ 'text/markdown': '**bold** and a [link](https://example.com)' });

    await waitFor(() => expect(container.querySelector('.output-markdown strong')).not.toBeNull());
    expect(container.querySelector('.output-markdown a')).toHaveAttribute(
      'href',
      'https://example.com'
    );
  });

  it('sanitises text/markdown from a notebook file', async () => {
    const { container } = show({
      'text/markdown': "kept <img src=x onerror=\"document.body.setAttribute('data-ran-md', '')\">",
    });

    await waitFor(() =>
      expect(container.querySelector('.output-markdown')).toHaveTextContent('kept')
    );
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(ran('md')).toBe(false);
  });

  it('renders image/gif as an image', () => {
    show({ 'image/gif': PIXEL, 'text/plain': '<IPython.core.display.Image object>' });

    expect(screen.getByAltText('Image output')).toHaveAttribute(
      'src',
      `data:image/gif;base64,${PIXEL}`
    );
  });

  it('shows application/pdf in the browser’s viewer', () => {
    show({ 'application/pdf': 'JVBERi0=', 'text/plain': '<PDF object>' });

    expect(screen.getByLabelText('PDF output')).toHaveAttribute(
      'data',
      'data:application/pdf;base64,JVBERi0='
    );
  });

  // The ones above must not reach this fallback, or they look unsupported.
  it('falls back to text/plain for a bundle it cannot render', () => {
    show({ 'application/octet-stream': 'x', 'text/plain': 'a plain description' });

    expect(screen.getByText('a plain description')).toBeInTheDocument();
  });
});

// The two pairs Bokeh 3.4 sends, abridged: `output_notebook()`, then `show(p)`.
describe('Bokeh outputs', () => {
  const loading = {
    output_type: 'display_data',
    data: { 'text/html': '<span id="load-1">Loading BokehJS ...</span>' },
  };
  const loader = {
    output_type: 'display_data',
    data: {
      'application/javascript': 'loadForClassicNotebook()',
      'application/vnd.bokehjs_load.v0+json': 'load()',
    },
  };
  const root = {
    output_type: 'display_data',
    data: { 'text/html': '<div id="el-1" data-root-id="p1001" style="display: contents;"></div>' },
  };
  const chart = {
    output_type: 'display_data',
    data: {
      'application/javascript':
        'const docs_json = {"d":{"version":"3.4.3","title":"</script>"}}; embed(docs_json)',
      'application/vnd.bokehjs_exec.v0+json': '',
    },
    metadata: { 'application/vnd.bokehjs_exec.v0+json': { id: 'p1001' } },
  };
  const frames = (outputs: object[]) =>
    render(
      <OutputBundles outputs={outputs as NotebookOutput[]} widgets={null} />
    ).container.querySelectorAll('iframe.output-sandbox');

  it('runs each script in one frame with the HTML before it', () => {
    const outputs = [loading, loader, root, chart].map((each) => markProducedHere({ ...each }));
    const [load, plot] = Array.from(frames(outputs)).map((f) => f.getAttribute('srcdoc') ?? '');

    expect(frames(outputs)).toHaveLength(2);
    expect(load).toContain('Loading BokehJS');
    expect(load).toContain('<script>load()</script>');
    expect(load).not.toContain('loadForClassicNotebook');
    expect(plot).toContain('data-root-id="p1001"');
    expect(plot).toContain('src="https://cdn.bokeh.org/bokeh/release/bokeh-3.4.3.min.js"');
    expect(plot).toContain('src="https://cdn.bokeh.org/bokeh/release/bokeh-widgets-3.4.3.min.js"');
    expect(plot).toContain('"title":"<\\/script>"');
    expect(plot.indexOf('bokeh-3.4.3.min.js')).toBeLessThan(plot.indexOf('embed(docs_json)'));
  });

  it('shows neither half from a notebook file', () => {
    const { container } = render(
      <OutputBundles outputs={[loading, loader, root, chart] as NotebookOutput[]} widgets={null} />
    );

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('leaves HTML that no Bokeh script follows to itself', () => {
    const other = { ...chart, metadata: { 'application/vnd.bokehjs_exec.v0+json': { id: 'p2' } } };
    const outputs = [root, other].map((each) => markProducedHere({ ...each }));
    const [plot] = Array.from(frames(outputs)).map((f) => f.getAttribute('srcdoc') ?? '');

    expect(plot).not.toContain('data-root-id');
  });
});
