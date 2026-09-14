// Which representation of an output bundle is shown, for the types a kernel sends as something
// other than text. The bundles below are the shapes IPython's `display()` actually emits.
import { render, screen, waitFor } from '@testing-library/react';
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
  // Bokeh and similar libraries ship markup plus a bootstrap script.
  it('runs the scripts in text/html', () => {
    showFromKernel({
      'text/html': "<script>document.body.setAttribute('data-ran-kernel', '')</script>",
    });

    expect(ran('kernel')).toBe(true);
  });
});

describe('OutputBundles', () => {
  it('renders image/png as an image', () => {
    show({ 'image/png': PIXEL, 'text/plain': '<IPython.core.display.Image object>' });

    expect(screen.getByAltText('cell output')).toHaveAttribute(
      'src',
      `data:image/png;base64,${PIXEL}`
    );
  });

  it('renders image/jpeg as an image', () => {
    show({ 'image/jpeg': PIXEL, 'text/plain': '<IPython.core.display.Image object>' });

    expect(screen.getByAltText('cell output')).toHaveAttribute(
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

  // The three above used to fall through to here, which is what made them look unsupported.
  it('falls back to text/plain for a bundle it cannot render', () => {
    show({ 'application/octet-stream': 'x', 'text/plain': 'a plain description' });

    expect(screen.getByText('a plain description')).toBeInTheDocument();
  });
});
