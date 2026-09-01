import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';

// Required, not optional polish: KaTeX emits a visual HTML copy *and* an
// accessible MathML copy of every formula, and this stylesheet is what hides the
// second one. Without it both render and each formula appears twice. Importing it
// here rather than in a global stylesheet keeps it in the lazy chunk alongside
// the renderer, and lets Vite emit the KaTeX web fonts it references.
import 'katex/dist/katex.min.css';

/**
 * A rendered markdown cell.
 *
 * This module exists to be a code-splitting boundary: react-markdown plus the
 * remark/rehype plugins and katex are the largest thing the notebook pulls in,
 * and none of it is needed until a notebook with a markdown cell is opened. Keep
 * the heavy imports above confined to this file — importing them anywhere in the
 * eagerly loaded tree puts them straight back into the main bundle. Cell.tsx
 * loads it with React.lazy.
 *
 * `rehypeRaw` is what allows raw HTML inside a markdown cell, matching Jupyter.
 */
const MarkdownRenderer = ({ source }: { source: string }) => (
  <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex, rehypeRaw]}>
    {source}
  </Markdown>
);

export default MarkdownRenderer;
