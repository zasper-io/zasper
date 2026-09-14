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

  // A srcdoc iframe shares this page's origin, so its script could read the session token.
  it('drops iframes and scripts from raw HTML', () => {
    const source = [
      '<iframe srcdoc="<script>parent.ranFromMarkdown = true</script>"></iframe>',
      '',
      "<script>document.body.setAttribute('data-ran-markdown', '')</script>",
      '',
      'text',
    ].join('\n');
    const { container } = render(<MarkdownRenderer source={source} />);

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(document.body.hasAttribute('data-ran-markdown')).toBe(false);
  });

  it('keeps the raw HTML and GFM that notebooks lay text out with', () => {
    const source = [
      '<details><summary>More</summary>',
      '',
      'hidden',
      '',
      '</details>',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '- [x] done',
    ].join('\n');
    const { container } = render(<MarkdownRenderer source={source} />);

    expect(container.querySelector('details > summary')).not.toBeNull();
    expect(container.querySelector('table td')).not.toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
  });
});
