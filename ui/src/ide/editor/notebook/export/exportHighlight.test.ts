import { describe, expect, it } from 'vitest';

import { escapeHtml, highlightCss, highlightSource } from './exportHighlight';

describe('highlightSource', () => {
  it('wraps Python keywords and strings in classed spans', async () => {
    const html = await highlightSource('import pandas as pd\nx = "hi"', 'python');

    expect(html).toContain('<span class="');
    expect(html).toContain('import');
    expect(html).toContain('&quot;hi&quot;');
  });

  it('keeps the source exactly, tags aside', async () => {
    const source = 'def f(x):\n    return x < 1 & 2\n';
    const html = await highlightSource(source, 'python');

    const text = new DOMParser().parseFromString(`<pre>${html}</pre>`, 'text/html').body
      .textContent;
    expect(text).toBe(source);
  });

  // The name is matched the way `lazyLanguageNamed` matches it, fuzzily, so the kernel language that
  // claims nothing has to be one no real grammar's name contains.
  it('escapes rather than highlights a language nothing claims', async () => {
    const html = await highlightSource('<b>not html</b>', 'zzz');

    expect(html).toBe('&lt;b&gt;not html&lt;/b&gt;');
  });

  it('highlights a language that has to be loaded', async () => {
    const html = await highlightSource('let x = 1;', 'javascript');

    expect(html).toContain('<span class="');
  });
});

describe('highlightCss', () => {
  it('produces the rules for the classes it emits', async () => {
    const html = await highlightSource('import pandas', 'python');
    const firstClass = /class="([^"]+)"/.exec(html)?.[1].split(' ')[0];

    expect(firstClass).toBeDefined();
    expect(highlightCss()).toContain(firstClass as string);
  });
});

describe('escapeHtml', () => {
  it('closes the four holes a cell can put markup through', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
