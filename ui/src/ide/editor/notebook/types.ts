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
  id: string;
  execution_count: number;
  source: string;
  outputs: ICellOutput[];
  metadata: Record<string, unknown>;
  reload: boolean;
}

/**
 * The kernel websocket, as handed down to widget output. Left loose because the
 * comm-based widget protocol is not wired up yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IKernelConnection = any;

/**
 * The subset of a keyboard event the notebook shortcut handler reads. CodeMirror
 * cells forward synthesised events, so a full React event is not always available.
 */
export interface INotebookKeyEvent {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  preventDefault: () => void;
}

export interface INotebookModel {
  cells: Array<ICell>;
  nbformat: number;
  nbformat_minor: number;
  metadata: INotebookMetadata;
}

export interface INotebookMetadata {
  kernelspec?: string;
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
