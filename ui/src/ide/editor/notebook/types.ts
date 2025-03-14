import { ICell } from './Cell';

export interface INotebookModel {
  cells: Array<ICell>;
  nbformat: number;
  nbformat_minor: number;
  metadata: INotebookMetadata;
}

export interface INotebookMetadata {
  kernelspec?: IKernelspecMetadata;
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
