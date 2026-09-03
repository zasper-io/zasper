// The nbformat document, as it arrives from /api/contents and goes back on save.
//
// These live here rather than under ide/editor/notebook/ because api/contents.ts
// needs them, and api/ must not import from the component tree. The notebook
// feature's own view-model types (key events, the kernel connection handle) stay
// in ide/editor/notebook/types.ts.

export type CellType = 'code' | 'markdown' | 'raw' | string;

/**
 * A single Jupyter output bundle. Only the fields the renderer inspects are
 * named; the index signature covers the mime-typed keys such as `text/plain`
 * and `image/png` that kernels send.
 */
export interface ICellOutput {
  output_type?: string;
  name?: string;
  text?: string;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  execution_count?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface ICell {
  cell_type: CellType;
  /**
   * The document's own cell id, from nbformat 4.5 onwards. A cell out of an older notebook has
   * none, and is given one on load so that React and the kernel have something to key on.
   */
  id: string;
  source: string;
  metadata: Record<string, unknown>;
  /** Code cells only, and null until the cell has run. */
  execution_count?: number | null;
  /** Code cells only. */
  outputs?: ICellOutput[];
  /** Markdown and raw cells only: images pasted into the cell, keyed by name then mime type. */
  attachments?: Record<string, Record<string, unknown>>;
  /**
   * Client-side only, like IContentEntry.id in contents.ts — the server neither
   * sends nor stores it. Set when a cell's editor needs to be remounted.
   */
  reload: boolean;
}

export interface INotebookModel {
  cells: Array<ICell>;
  nbformat: number;
  nbformat_minor: number;
  metadata: INotebookMetadata;
}

export interface INotebookMetadata {
  /** An object per nbformat; the bare string is what Zasper wrote here before, so it is on disk. */
  kernelspec?: IKernelspecMetadata | string;
  name?: string;
  display_name?: string;
  language_info?: ILanguageInfoMetadata;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface IKernelspecMetadata {
  name: string;
  display_name: string;
}

export interface ILanguageInfoMetadata {
  name: string;
  /** A mode name, or the object form that IPython writes: `{name: 'ipython', version: 3}`. */
  codemirror_mode?: string | Record<string, unknown>;
  file_extension?: string;
  mimetype?: string;
  pygments_lexer?: string;
}
