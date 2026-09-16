import { NotebookCell, NotebookModel, NotebookOutput } from '@/api';

import { cellSource, joinOutputLines, notebookLanguage } from './exportFormats';

/*
A notebook as a Markdown document — marimo's `export md`, and the format a notebook goes into a
repository's README as.

Prose stays prose: a markdown cell is written out as it was typed, so the export reads as a document
rather than as a transcript of one. Code becomes a fenced block tagged with the kernel's language, which
is what makes GitHub, a static site generator and every Markdown editor highlight it.

What this deliberately does not do is round-trip. Jupytext's Markdown format carries cell metadata in
fence attributes so that a `.md` can be read back as a notebook; that is a different feature with a
different reader, and writing half of it would produce files that look like jupytext's and are not.
*/

export interface MarkdownExportOptions {
  /** Outputs are in the file by default: a notebook without them is the script export. */
  includeOutputs?: boolean;
  /** The attached kernel's language, which beats what the file records. See `notebookLanguage`. */
  language?: string;
}

/**
 * Escape codes stripped rather than converted. Markdown has nowhere to put a colour, and a traceback
 * full of raw escape sequences is worse than one in plain text — the HTML export is where colour
 * survives.
 */
function stripAnsi(text: string): string {
  // CSI sequences, which is all a kernel sends: ESC [ … final byte.
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/** A fenced block whose fence is long enough to survive backticks in the text it holds. */
function fence(text: string, tag = ''): string {
  const longest = [...text.matchAll(/`+/g)].reduce((most, run) => Math.max(most, run[0].length), 0);
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  const body = text.endsWith('\n') ? text : `${text}\n`;
  return `${ticks}${tag}\n${body}${ticks}`;
}

/**
 * One output as Markdown, or '' for one Markdown cannot carry.
 *
 * The order the bundle is read in is `OutputBundles`' own, so that an export and the screen never
 * disagree about which representation of an output wins.
 */
function outputToMarkdown(raw: NotebookOutput): string {
  const output = joinOutputLines(raw);

  if (output.output_type === 'error') {
    const head = `${output.ename ?? 'Error'}: ${output.evalue ?? ''}`.trim();
    const traceback = output.traceback?.join('\n') ?? '';
    return fence(stripAnsi(traceback === '' ? head : traceback));
  }

  if (typeof output.text === 'string' && output.text !== '') {
    return fence(stripAnsi(output.text));
  }

  if (typeof output['text/plain'] === 'string' && output['text/plain'] !== '') {
    return fence(stripAnsi(output['text/plain']));
  }

  const data = output.data;
  if (!data) {
    return '';
  }

  // An image is the one output Markdown carries natively, and it carries it best: a data URL keeps the
  // file self-contained, which a link to a figures/ directory the export never wrote would not.
  if (typeof data['image/png'] === 'string') {
    return `![](data:image/png;base64,${data['image/png'].replace(/\s+/g, '')})`;
  }
  if (typeof data['image/jpeg'] === 'string') {
    return `![](data:image/jpeg;base64,${data['image/jpeg'].replace(/\s+/g, '')})`;
  }

  // Markdown from a kernel — IPython's `display(Markdown(...))` — is already the target format.
  if (typeof data['text/markdown'] === 'string') {
    return data['text/markdown'];
  }

  // LaTeX goes in as maths rather than as text, because that is what every Markdown renderer with
  // maths support is waiting for. A payload that brought its own delimiters keeps them.
  if (typeof data['text/latex'] === 'string') {
    return data['text/latex'];
  }

  // Raw HTML is legal in Markdown and is how a DataFrame stays a table. It is not sanitised here: a
  // `.md` file is text until something renders it, and the thing that renders it does the sanitising.
  // The HTML export, which produces a page a browser opens directly, does sanitise.
  if (typeof data['text/html'] === 'string') {
    return data['text/html'].trim();
  }

  if (typeof data['text/plain'] === 'string') {
    return fence(stripAnsi(data['text/plain']));
  }

  if (data['application/json'] !== undefined) {
    return fence(JSON.stringify(data['application/json'], null, 2), 'json');
  }

  // Said rather than dropped silently, and said the way the notebook says it on screen.
  const arrived = Object.keys(data).join(', ');
  return arrived === '' ? '' : `*This output cannot be displayed (${arrived}).*`;
}

function cellToMarkdown(cell: NotebookCell, language: string, includeOutputs: boolean): string[] {
  const source = cellSource(cell.source);
  const blocks: string[] = [];

  if (cell.cell_type === 'markdown') {
    if (source.trim() !== '') {
      blocks.push(source.replace(/\n+$/, ''));
    }
    return blocks;
  }

  if (cell.cell_type === 'raw') {
    // A raw cell is by definition not Markdown — nbconvert passes it through to the target format and
    // there is no target here — so it goes in a fence, where it reads as what it is rather than as
    // prose that lost its formatting.
    if (source.trim() !== '') {
      blocks.push(fence(source));
    }
    return blocks;
  }

  if (source.trim() !== '') {
    blocks.push(fence(source.replace(/\n+$/, ''), language));
  }

  if (includeOutputs) {
    for (const output of cell.outputs ?? []) {
      const block = outputToMarkdown(output);
      if (block !== '') {
        blocks.push(block);
      }
    }
  }

  return blocks;
}

/** The whole notebook as one Markdown document. */
export function notebookToMarkdown(
  notebook: NotebookModel,
  options: MarkdownExportOptions = {}
): string {
  const includeOutputs = options.includeOutputs ?? true;
  const language = notebookLanguage(notebook, options.language);

  const blocks = notebook.cells.flatMap((cell) => cellToMarkdown(cell, language, includeOutputs));

  // One blank line between blocks, and a final newline: a Markdown file without one is a file every
  // diff shows as changed the first time something else touches it.
  return blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`;
}
