import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MarkdownRenderer from './MarkdownRenderer';

const LORENZ = [
  'We explore the Lorenz system of differential equations:',
  '',
  '$$',
  '\\begin{aligned}',
  '\\dot{x} & = \\sigma(y-x) \\\\',
  '\\dot{y} & = \\rho x - y - xz',
  '\\end{aligned}',
  '$$',
  '',
  "Let's change (\\\\(\\sigma\\\\)) with ipywidgets.",
].join('\n');

describe('MarkdownRenderer', () => {
  it('renders display maths as KaTeX', () => {
    const { container } = render(<MarkdownRenderer source={LORENZ} />);

    expect(container.querySelector('.katex-display')).not.toBeNull();
    expect(container.querySelectorAll('.katex').length).toBe(2);
  });

  // KaTeX stacks the rows of an `aligned` with `top` and `height` written into a `style` attribute on
  // every span; the classes alone position nothing. react-markdown parses that attribute with
  // `style-to-js`, and when a version of it lands whose default export ESM cannot reach, the parse
  // throws, `ignoreInvalidStyle` swallows it, and *every* style is dropped in silence — the formula
  // renders as its rows piled on one line. Nothing else in the suite would notice.
  it('keeps the inline styles KaTeX lays the rows out with', () => {
    const { container } = render(<MarkdownRenderer source={LORENZ} />);

    const styled = container.querySelectorAll('.katex [style]');
    expect(styled.length).toBeGreaterThan(0);
    expect([...styled].some((el) => /top:/.test(el.getAttribute('style') ?? ''))).toBe(true);
  });
});
