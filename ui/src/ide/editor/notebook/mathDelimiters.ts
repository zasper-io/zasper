/**
 * MathJax's bracket delimiters, rewritten to the dollar forms `remark-math` understands.
 *
 * Jupyter runs MathJax, which accepts `\(x\)` and `\[x\]` as well as `$x$` and `$$x$$` — and because a
 * notebook's source is JSON, the LaTeX in one is usually written `\\(x\\)`, which markdown then
 * unescapes to `\(x\)`. `remark-math` reads only the dollar forms, so every notebook written the
 * documented Jupyter way rendered its inline maths as literal backslashes and parentheses.
 *
 * Both delimiters of a pair have to be present for either to be rewritten. That is the whole of the
 * safety here: `\[` on its own is markdown's escape for a literal bracket, and a blind replacement
 * would turn `\[draft\]` in a sentence into display maths. Requiring the pair leaves an unmatched
 * escape alone.
 */

/** A fence opens a code block; nothing inside one is markdown, let alone maths. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** `\(x\)` and `\\(x\\)`, and the same for the display pair. Lazy, so `\(a\) and \(b\)` is two. */
const PAIRS: { pattern: RegExp; delimiter: string }[] = [
  { pattern: /\\\\\((.+?)\\\\\)/gs, delimiter: '$' },
  { pattern: /\\\\\[(.+?)\\\\\]/gs, delimiter: '$$' },
  { pattern: /\\\((.+?)\\\)/gs, delimiter: '$' },
  { pattern: /\\\[(.+?)\\\]/gs, delimiter: '$$' },
];

/** Inline code spans, which are kept exactly as written. */
const CODE_SPAN = /(`+[^`]*`+)/g;

function rewriteProse(text: string): string {
  return text
    .split(CODE_SPAN)
    .map((part, index) => (index % 2 === 1 ? part : rewrite(part)))
    .join('');
}

function rewrite(text: string): string {
  let out = text;
  for (const { pattern, delimiter } of PAIRS) {
    // A function replacement, because `$` in a replacement string is a group reference: writing the
    // dollars literally would silently insert the match instead.
    out = out.replace(pattern, (_, inner: string) => `${delimiter}${inner}${delimiter}`);
  }
  return out;
}

export function normalizeMathDelimiters(source: string): string {
  // Segment first, rewrite second. A display pair almost always spans lines — `\\[` on one, the maths
  // on the next — so the rewrite has to see a whole run of prose at once; a line at a time would only
  // ever find the inline pairs.
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (prose.length > 0) {
      out.push(rewriteProse(prose.join('\n')));
      prose = [];
    }
  };

  for (const line of source.split('\n')) {
    if (fence !== null) {
      out.push(line);
      // Closed by a run of the same character at least as long as the one that opened it.
      if (new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) {
        fence = null;
      }
      continue;
    }

    const opener = FENCE.exec(line);
    if (opener) {
      flush();
      out.push(line);
      fence = opener[1];
      continue;
    }

    prose.push(line);
  }

  flush();
  return out.join('\n');
}

/**
 * Whether a fragment already carries maths delimiters of either kind.
 *
 * For `text/latex` outputs, which are maths whether or not they say so: IPython's `Math` and SymPy
 * wrap what they emit in `$…$`, while a hand-written `Latex(r"\begin{align}…")` does not, and the
 * second has to be wrapped before remark-math will read it as anything but prose.
 */
export function hasMathDelimiters(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.length > 1 && trimmed.startsWith('$') && trimmed.endsWith('$')) ||
    (trimmed.startsWith('\\(') && trimmed.endsWith('\\)')) ||
    (trimmed.startsWith('\\[') && trimmed.endsWith('\\]'))
  );
}
