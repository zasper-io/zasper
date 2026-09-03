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
   * Replaced client-side on load: cell ids double as the kernel request msg_id,
   * so they have to be unique per session rather than per document.
   */
  id: string;
  execution_count: number;
  source: string;
  outputs: ICellOutput[];
  metadata: Record<string, unknown>;
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
  orig_nbformat?: number;
}

export interface IKernelspecMetadata {
  name: string;
  display_name: string;
}

export interface ILanguageInfoMetadata {
  name: string;
  codemirror_mode?: string;
  file_extension?: string;
  mimetype?: string;
  pygments_lexer?: string;
}
