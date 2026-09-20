import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeSchema } from 'rehype-sanitize';

import { normalizeMathDelimiters } from './mathDelimiters';

// Required: KaTeX emits a visual HTML copy and a MathML one, and this hides the second — without it
// every formula renders twice. Imported here so it stays in the lazy chunk with its web fonts.
import 'katex/dist/katex.min.css';

/**
 * A rendered markdown cell, and a code-splitting boundary: react-markdown, the remark/rehype plugins
 * and katex are the heaviest thing the notebook pulls in. Keep those imports in this file — importing
 * them in the eager tree puts them back in the main bundle. Cell.tsx loads it with React.lazy.
 *
 * `rehypeRaw` allows the raw HTML Jupyter allows, so it is sanitised before KaTeX adds markup of its
 * own: an `<iframe srcdoc>` would otherwise run script in this origin. `remarkGfm` is what gives
 * CommonMark the tables, strikethrough, task lists and bare links Jupyter renders.
 */
// GitHub's schema, plus the classes remark-math marks formulas with, which rehype-katex looks for.
const schema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
};

export interface MarkdownRendererProps {
  source: string;
  /**
   * What KaTeX emits. `mathml` drops the HTML copy and with it the stylesheet and five web fonts,
   * which is what the export needs (export/toHtml.tsx): it cannot link to a font.
   */
  katexOutput?: 'htmlAndMathml' | 'mathml';
}

const MarkdownRenderer = ({ source, katexOutput }: MarkdownRendererProps) => {
  // `remark-math` reads `$x$` and nothing else; Jupyter's notebooks are full of `\\(x\\)`.
  const text = useMemo(() => normalizeMathDelimiters(source), [source]);

  return (
    // The styling hook: markdown emits h1/table/blockquote with no classes for NotebookEditor.scss.
    <div className="zasper-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, schema],
          [rehypeKatex, { output: katexOutput ?? 'htmlAndMathml' }],
        ]}
      >
        {text}
      </Markdown>
    </div>
  );
};

export default MarkdownRenderer;
