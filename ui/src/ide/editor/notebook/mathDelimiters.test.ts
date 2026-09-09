import { describe, expect, it } from 'vitest';

import { normalizeMathDelimiters } from './mathDelimiters';

describe('normalizeMathDelimiters', () => {
  it('rewrites the inline pair MathJax accepts and remark-math does not', () => {
    expect(normalizeMathDelimiters('change \\(\\sigma\\) here')).toBe('change $\\sigma$ here');
  });

  it('rewrites the doubled form a notebook is written in', () => {
    // What the Lorenz notebook holds: JSON doubles every backslash, so this is what the cell says.
    expect(normalizeMathDelimiters('(\\\\(\\sigma\\\\), \\\\(\\beta\\\\))')).toBe(
      '($\\sigma$, $\\beta$)'
    );
  });

  it('rewrites the display pair to the display dollars', () => {
    expect(normalizeMathDelimiters('\\[x^2\\]')).toBe('$$x^2$$');
    expect(normalizeMathDelimiters('\\\\[x^2\\\\]')).toBe('$$x^2$$');
  });

  it('takes each pair separately rather than everything between the first and the last', () => {
    expect(normalizeMathDelimiters('\\(a\\) and \\(b\\)')).toBe('$a$ and $b$');
  });

  it('leaves an unmatched escape alone, which is what markdown means by it', () => {
    // `\[` on its own is markdown's escape for a literal bracket. Rewriting it would turn a word in
    // brackets into display maths.
    expect(normalizeMathDelimiters('a \\[draft note')).toBe('a \\[draft note');
    expect(normalizeMathDelimiters('\\(unclosed')).toBe('\\(unclosed');
  });

  it('leaves the dollar forms as they are', () => {
    expect(normalizeMathDelimiters('$x$ and $$y$$')).toBe('$x$ and $$y$$');
  });

  it('does not reach into an inline code span', () => {
    expect(normalizeMathDelimiters('write `\\(x\\)` for inline')).toBe(
      'write `\\(x\\)` for inline'
    );
  });

  it('does not reach into a fenced block', () => {
    const source = ['before \\(a\\)', '```', 'print("\\(a\\)")', '```', 'after \\(b\\)'].join('\n');
    expect(normalizeMathDelimiters(source)).toBe(
      ['before $a$', '```', 'print("\\(a\\)")', '```', 'after $b$'].join('\n')
    );
  });

  it('closes a fence only on a run as long as the one that opened it', () => {
    const source = ['````', '```', '\\(a\\)', '````', '\\(b\\)'].join('\n');
    expect(normalizeMathDelimiters(source)).toBe(
      ['````', '```', '\\(a\\)', '````', '$b$'].join('\n')
    );
  });

  it('spans lines, because display maths usually does', () => {
    expect(normalizeMathDelimiters('\\[\nx + y\n\\]')).toBe('$$\nx + y\n$$');
  });
});
