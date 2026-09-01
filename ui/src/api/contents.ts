import { INotebookModel } from '../ide/editor/notebook/types';
import { requestEmpty, requestJson, requestText } from './client';

export type ContentType = 'file' | 'directory' | 'notebook';

/**
 * An entry of a directory listing. `id` is generated client-side by the file
 * browser, the server does not send it.
 */
export interface IContentEntry {
  id?: string;
  type: string;
  path: string;
  name: string;
  content: IContentEntry[];
}

/** The server's content model; `content` varies with the requested type. */
export interface IContentModel<T> {
  name: string;
  type: string;
  path: string;
  content: T;
}

/**
 * Reads a directory listing. The server decides between directory, file and
 * notebook from the path itself, so no type has to be passed here.
 */
export function getDirectory(path: string): Promise<IContentEntry> {
  return requestJson<IContentEntry>('/api/contents', {
    method: 'POST',
    body: { path },
  });
}

/** Reads a single file as text. */
export async function getFileContent(path: string): Promise<string> {
  const model = await requestJson<IContentModel<string>>('/api/contents', {
    method: 'POST',
    body: { path },
  });
  return model.content;
}

/** Reads a notebook document. */
export function getNotebook(path: string): Promise<IContentModel<INotebookModel>> {
  return requestJson<IContentModel<INotebookModel>>('/api/contents', {
    method: 'POST',
    body: { path, type: 'notebook' },
  });
}

/** Creates an untitled file, directory or notebook inside `parentDir`. */
export function createContent(parentDir: string, type: ContentType): Promise<IContentEntry> {
  return requestJson<IContentEntry>('/api/contents/create', {
    method: 'POST',
    body: { parent_dir: parentDir, type },
  });
}

export function renameContent(parentDir: string, oldName: string, newName: string): Promise<void> {
  return requestEmpty('/api/contents/rename', {
    method: 'POST',
    body: { parent_dir: parentDir, old_name: oldName, new_name: newName },
  });
}

export function deleteContent(path: string): Promise<void> {
  return requestEmpty('/api/contents', {
    method: 'DELETE',
    body: { path },
  });
}

export function saveFile(path: string, content: string): Promise<void> {
  return requestEmpty('/api/contents', {
    method: 'PUT',
    body: { path, content, type: 'file', format: 'text' },
  });
}

export function saveNotebook(path: string, notebook: INotebookModel): Promise<void> {
  return requestEmpty('/api/contents', {
    method: 'PUT',
    body: { path, content: notebook, type: 'notebook', format: 'json' },
  });
}

/** Uploads a file into `parentPath`; resolves with the server's status message. */
export function uploadFile(parentPath: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append('parentPath', parentPath);
  formData.append('file', file);

  return requestText('/api/contents/upload', { method: 'POST', body: formData });
}
