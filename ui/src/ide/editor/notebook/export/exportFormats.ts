import { baseName } from '@/paths';
import { NotebookModel, NotebookOutput } from '@/api';

/*
The formats a notebook can leave Zasper as, and the few facts about a notebook that all three of them
need.

Everything in this folder converts the notebook the editor is holding, not the file on disk: unsaved
edits and the output the kernel produced a moment ago are in the export, which is the whole reason the
conversion is here and not in the server. It also means every `source`, every stream's `text` and every
textual mime bundle is already a plain string — nbformat's multiline lists are joined on the way in by
internal/nbformat/lines.go, so nothing here has to handle the list form.
*/

export type ExportFormatId = 'html' | 'markdown' | 'script';

export interface ExportFormat {
  id: ExportFormatId;
  /** What the menu row says. */
  label: string;
  /** Without the dot, except for the script, whose extension comes from the kernel. */
  extension: string;
  mimeType: string;
}

export const EXPORT_FORMATS: Record<Exclude<ExportFormatId, 'script'>, ExportFormat> = {
  html: { id: 'html', label: 'HTML page', extension: 'html', mimeType: 'text/html' },
  markdown: { id: 'markdown', label: 'Markdown', extension: 'md', mimeType: 'text/markdown' },
};

/**
 * The notebook's language, as a Markdown fence tag and as the name a reader picks a lexer from.
 *
 * `attached` is the language of the kernel the editor is talking to, and it wins: it is the only one
 * of the three that is a fact rather than a record. `language_info` is written into the file by the
 * kernel and is the next best; `kernelspec.language` is what a notebook that has never run has, and
 * nbformat makes it optional — plenty of real notebooks carry a kernelspec naming no language at all.
 *
 * Empty when nothing says, which leaves a fence untagged rather than tagged wrongly.
 */
export function notebookLanguage(notebook: NotebookModel, attached?: string): string {
  if (typeof attached === 'string' && attached.trim() !== '') {
    return attached.trim();
  }

  const fromInfo = notebook.metadata?.language_info?.name;
  if (typeof fromInfo === 'string' && fromInfo !== '') {
    return fromInfo;
  }
  const kernelspec = notebook.metadata?.kernelspec;
  // The bare string is in real notebooks on disk, Zasper's own among them.
  if (typeof kernelspec === 'object' && kernelspec !== null) {
    return kernelspec.language ?? '';
  }
  return '';
}

/**
 * The extension a script export saves under, without the dot. `language_info.file_extension` carries
 * the dot per nbformat (`.py`), so it is taken off here rather than at every call site.
 *
 * Python is the fallback rather than `.txt`: a notebook with no `language_info` has never run, and
 * the overwhelming majority of those are Python.
 */
export function scriptExtension(notebook: NotebookModel, attached?: string): string {
  const declared = notebook.metadata?.language_info?.file_extension;
  if (typeof declared === 'string' && declared !== '') {
    return declared.replace(/^\./, '');
  }
  // A running kernel names its language but not its file extension, so the few that are not spelled
  // the same as the language go here. Anything else takes its own name, which is right far more often
  // than it is wrong — `julia.jl` is the exception, `ruby.rb` is not.
  const language = attached?.trim().toLowerCase() ?? '';
  const known: Record<string, string> = {
    python: 'py',
    julia: 'jl',
    ruby: 'rb',
    javascript: 'js',
    typescript: 'ts',
    haskell: 'hs',
    rust: 'rs',
  };
  if (language !== '') {
    return known[language] ?? language;
  }
  return 'py';
}

/** The name the browser saves under: the notebook's own name with its extension replaced. */
export function exportFilename(path: string, extension: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${extension}`;
}

/**
 * A cell's source as a string. `NotebookCell.source` is typed as one because the server joins the
 * multiline form, but a notebook that arrived by another route — a test fixture, a paste, a file read
 * straight off disk — can still hold the list, and an export is not the place to throw over it.
 */
export function cellSource(source: unknown): string {
  if (typeof source === 'string') {
    return source;
  }
  if (Array.isArray(source)) {
    return source.filter((line) => typeof line === 'string').join('');
  }
  return '';
}

/** Whether a mime type's value is arbitrary JSON, and so never a list of lines. Mirrors isJSONMime. */
function isJsonMime(mime: string): boolean {
  return mime === 'application/json' || (mime.startsWith('application/') && mime.endsWith('+json'));
}

function joinLines(value: unknown): unknown {
  return Array.isArray(value) && value.every((line) => typeof line === 'string')
    ? value.join('')
    : value;
}

/**
 * An output with its multiline strings joined, the way the server joins them on the way in
 * (internal/nbformat/lines.go): a stream's `text`, and every textual value in a mime bundle.
 *
 * The same reason as `cellSource`. In the app this is a no-op — nothing reaches the editor unjoined —
 * but it is what lets these functions be handed a notebook straight from a file, and a `text/latex`
 * that arrives as a list of lines is the difference between a rendered formula and a thrown error.
 */
export function joinOutputLines(output: NotebookOutput): NotebookOutput {
  // `text` is a stream's own field and is always text; a bundle's values are whatever the mime says.
  const joinedText = joinLines(output.text);
  const text = typeof joinedText === 'string' ? joinedText : output.text;
  const data = output.data;

  let bundle = data;
  if (data) {
    bundle = Object.fromEntries(
      Object.entries(data).map(([mime, value]) => [
        mime,
        isJsonMime(mime) ? value : joinLines(value),
      ])
    );
  }

  if (text === output.text && bundle === data) {
    return output;
  }
  return data ? { ...output, text, data: bundle } : { ...output, text };
}
