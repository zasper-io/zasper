import { requestBlob, requestEmpty, requestJson, requestUpload } from './client';
import { INotebookModel } from './notebook';

export type ContentType = 'file' | 'directory' | 'notebook';

/**
 * An entry of a directory listing. Rows are keyed by `path`, which is unique by construction.
 *
 * Everything below the name is optional because it is metadata about the entry rather than the entry:
 * a reader that does not need it should not have to know it is there, and a listing built by hand in
 * a test is still a listing.
 */
export interface IContentEntry {
  type: string;
  path: string;
  name: string;
  content: IContentEntry[];
  /** Bytes. Meaningless for a directory, which the server reports as its own on-disk size. */
  size?: number;
  last_modified?: string;
  created?: string;
  /** False when this process cannot write it — a read-only file, or a read-only mount. */
  writable?: boolean;
  /** What git would not track. Dimmed rather than hidden: a file you went looking for should be
   *  findable even if it is generated. */
  ignored?: boolean;
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

/**
 * Moves a file or folder to another path, which is what a drag between folders and a cut-and-paste
 * both do. A rename is the special case where only the last segment changes, and `renameContent`
 * stays for it because the server refuses a separator there.
 */
export function moveContent(from: string, to: string): Promise<void> {
  return requestEmpty('/api/contents/move', {
    method: 'POST',
    body: { from, to },
  });
}

/**
 * Copies a file or folder into `toDir`, resolving with the entry the server made. Only the
 * destination folder is named: the server picks a free name, so duplicating in place is a copy into
 * the folder the original is already in.
 */
export function copyContent(from: string, toDir: string): Promise<IContentEntry> {
  return requestJson<IContentEntry>('/api/contents/copy', {
    method: 'POST',
    body: { from, to_dir: toDir },
  });
}

/**
 * Reads a file as bytes, for saving it to the reader's own machine. Not `getFileContent`: that goes
 * through the content model, which is text or base64 by type, and a download has to be the file
 * itself, byte for byte.
 */
export function downloadContent(path: string): Promise<Blob> {
  return requestBlob('/api/contents/download', { query: { path } });
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

export interface UploadRequest {
  /** The folder the file is going into; '' is the project root. */
  parentDir: string;
  file: File;
  /**
   * Where the file goes inside `parentDir`, which is how a whole folder is uploaded: the browser has
   * `notes/img/logo.png` for a file inside a dropped `notes`, and the server makes the folders on the
   * way. Defaults to the file's own name.
   */
  relativePath?: string;
  /** Overwrite what is already there. Without it the server answers 409 and writes nothing. */
  replace?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Uploads one file, resolving with the entry the server wrote. One request per file rather than one
 * for the batch, so that progress can be shown per file and one refused file does not take the rest
 * of a folder with it.
 */
export function uploadFile(request: UploadRequest): Promise<IContentEntry> {
  const form = new FormData();
  form.append('parent_dir', request.parentDir);
  form.append('relative_path', request.relativePath ?? request.file.name);
  if (request.replace === true) {
    form.append('replace', 'true');
  }
  form.append('file', request.file);

  return requestUpload<IContentEntry>('/api/contents/upload', {
    body: form,
    onProgress: request.onProgress,
    signal: request.signal,
  });
}
