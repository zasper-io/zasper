import { ANSI_SLOTS, ExportPalette, paletteToCss } from './exportTheme';
import { highlightCss } from './exportHighlight';

/*
The stylesheet an exported page carries.

Not the app's stylesheet. The app's is written for a window full of panes — a rail, a tab strip, a
scrolling notebook that has to fit between them — and none of that exists in a file someone opens on
its own. This is a document: one measure of prose down the middle, prompts in the margin, and nothing
to press.

Three rules it keeps to:

  - **No literal colour.** Every value is `var(--z-…)`, and the `:root` block that gives those tokens
    their values is read out of the compiled light theme at export time (exportTheme.ts). The code
    colours are generated from the editor's own highlight style (exportHighlight.ts). A colour written
    here by hand would be a fourth palette to keep in step with three others.
  - **Nothing is fetched.** No stylesheet link, no web font, no script. The faces are the reader's own,
    which is also why formulas are MathML rather than KaTeX's HTML — that needs KaTeX's fonts, and an
    export that 404s its own maths is worse than one that uses the browser's.
  - **The class names are the app's** wherever the markup is the app's. `OutputBundles` emits
    `output-error`, `output-stderr` and `output-svg`, and `ansi_up` emits `ansi-red-fg`; those keep
    their names here so that the two stylesheets can be read against each other. The export's own
    scaffolding is prefixed `zx-`.
*/

/** The ANSI palette rules, scoped the way NotebookEditor.scss scopes them: to the output box alone. */
function ansiCss(): string {
  return ANSI_SLOTS.flatMap((slot) => [
    `.zx-output .ansi-${slot}-fg { color: var(--z-ansi-${slot}); }`,
    `.zx-output .ansi-${slot}-bg { background-color: var(--z-ansi-${slot}); }`,
  ]).join('\n');
}

const DOCUMENT_CSS = `
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  padding: 32px 16px 64px;
  background: var(--z-bg-figure, #fff);
  color: var(--z-fg-default, #1f2124);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.6;
}

.zx-page { max-width: 46rem; margin: 0 auto; }

.zx-title { margin: 0; font-size: 1.6rem; line-height: 1.3; font-weight: 600; }

/* A byline, not a banner: a rule under it rather than a box around it. */
.zx-meta {
  margin: 4px 0 0;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--z-border-subtle, #e4e6e9);
  font-size: 0.8rem;
  color: var(--z-fg-subtle, #6b7076);
}

.zx-cell { display: flex; gap: 10px; margin-top: 20px; }

/* The prompt sits in the margin, as it does in the editor, so the code keeps the prose's left edge. */
.zx-prompt {
  flex: 0 0 2.6rem;
  padding-top: 9px;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  /* The accent as ink, for the same reason NotebookEditor.scss spends it here: the prompt is the one
     mark a reader looks for down the left edge. */
  color: var(--z-fg-serial-no, #0a5651);
  user-select: none;
}

.zx-source {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 9px 12px;
  overflow-x: auto;
  background: var(--z-bg-code, #f6f7f8);
  border: 1px solid var(--z-border-subtle, #e4e6e9);
  border-radius: 4px;
}

.zx-source, .zx-output pre, .zx-output code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.55;
}

/* Output is indented past the prompt gutter, so it belongs to the code above it without a second box
   around the pair. A cell whose code was left out has no gutter to clear. */
.zx-output {
  margin: 6px 0 0 calc(2.6rem + 10px);
  padding: 6px 10px;
  /* The tint the notebook puts under an output area, which is the accent's palest step. */
  background: var(--z-bg-cell-output, #f7fbfa);
  border-radius: 2px;
}
.zx-outputs-only .zx-output { margin-left: 0; }

/* An error already carries its own tint and must not sit on a second one. */
.zx-output:has(.output-error), .zx-output:has(.output-stderr) { background: none; padding: 0; }

.zx-output pre { margin: 0; padding: 6px 0; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }

.zx-output img, .zx-output svg { max-width: 100%; height: auto; }

/* A table from a DataFrame arrives as the kernel's own HTML, with a <style> of its own that this must
   not fight. Borders and padding only, so a frame that ships no CSS is still readable. */
.zx-output table { border-collapse: collapse; font-size: 0.8rem; }
.zx-output th, .zx-output td { padding: 3px 8px; border: 1px solid var(--z-border-subtle, #e4e6e9); text-align: right; }
.zx-output thead th { font-weight: 600; }

.output-stderr, .output-error {
  background: var(--z-bg-error-subtle, #fdf2f2);
  border-radius: 4px;
  padding: 6px 10px;
}

.output-error .ename { display: block; font-weight: 600; color: var(--z-status-error, #aa1a1a); }

/* Prose keeps the document's measure and its own spacing; a markdown cell is the one thing in the file
   that is not indented by a prompt gutter, because nothing produced it. */
.zasper-markdown { margin-top: 20px; }
.zasper-markdown > :first-child { margin-top: 0; }
.zasper-markdown h1, .zasper-markdown h2, .zasper-markdown h3 { line-height: 1.3; margin: 1.4em 0 0.5em; }
.zasper-markdown p, .zasper-markdown ul, .zasper-markdown ol { margin: 0 0 0.8em; }
.zasper-markdown code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--z-bg-code, #f4f4f4);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
}
.zasper-markdown pre { padding: 9px 12px; overflow-x: auto; background: var(--z-bg-code, #f4f4f4); border-radius: 4px; }
.zasper-markdown pre code { padding: 0; background: none; }
.zasper-markdown blockquote {
  margin: 0 0 0.8em;
  padding-left: 12px;
  border-left: 3px solid var(--z-border, #d8d8d8);
  color: var(--z-fg-muted, #6d6d6d);
}
.zasper-markdown table { border-collapse: collapse; }
.zasper-markdown th, .zasper-markdown td { padding: 4px 8px; border: 1px solid var(--z-border-subtle, #e4e6e9); }
.zasper-markdown img { max-width: 100%; height: auto; }

/* What an output the export could not carry says. A note, not an error: the file is fine, that one
   output is not in it. */
.zx-missing { margin: 6px 0 0; font-size: 0.8rem; font-style: italic; color: var(--z-fg-subtle, #6b7076); }

/* Paper. A page break inside a cell is the one thing printing gets wrong by default. */
@media print {
  body { padding: 0; }
  .zx-cell, .zx-output { break-inside: avoid; }
}
`;

/** The whole `<style>` body for an exported page. */
export function exportStylesheet(palette: ExportPalette): string {
  return [paletteToCss(palette), DOCUMENT_CSS.trim(), ansiCss(), highlightCss()]
    .filter((part) => part !== '')
    .join('\n\n');
}
