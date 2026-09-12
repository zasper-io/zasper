// Which representation of an output bundle is shown, for the types a kernel sends as something
// other than text. The bundles below are the shapes IPython's `display()` actually emits.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ICellOutput } from '@/api';

import { OutputBundles } from './CellOutput';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUg==';

function show(data: Record<string, unknown>) {
  const outputs = [{ output_type: 'display_data', data }] as ICellOutput[];
  return render(<OutputBundles outputs={outputs} widgets={null} />);
}

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
