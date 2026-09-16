import { requestBlob, requestEmpty, requestJson, requestUpload } from './client';
import { NotebookModel } from './notebook';

export type ContentType = 'file' | 'directory' | 'notebook';

/**
 * An entry of a directory listing. Rows are keyed by `path`, which is unique by construction.
 *
 * Everything below the name is optional because it is metadata about the entry rather than the entry:
 * a reader that does not need it should not have to know it is there, and a listing built by hand in
 * a test is still a listing.
 */
export interface ContentEntry {
  type: string;
  path: string;
  name: string;
  content: ContentEntry[];
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
export interface ContentModel<T> {
  name: string;
  type: string;
  path: string;
  content: T;
}

/**
 * Reads a directory listing. The server decides between directory, file and
 * notebook from the path itself, so no type has to be passed here.
 */
export function getDirectory(path: string): Promise<ContentEntry> {
  return requestJson<ContentEntry>('/api/contents', {
    method: 'POST',
    body: { path },
  });
}

/**
 * A file as the server sent it: its text when it is UTF-8 text, and base64 of its bytes when it is
 * not, since text that is not UTF-8 would come back from an editor with its bytes changed.
 */
export interface FileContent {
  format: 'text' | 'base64';
  content: string;
  mimetype: string;
}

/** Reads a single file, as text when it is text. */
export async function getFileContent(path: string): Promise<FileContent> {
  const model = await requestJson<ContentModel<string> & Omit<FileContent, 'content'>>(
    '/api/contents',
    {
      method: 'POST',
      body: { path },
    }
  );
  return { format: model.format, content: model.content, mimetype: model.mimetype };
}

/** Reads a notebook document. */
export function getNotebook(path: string): Promise<ContentModel<NotebookModel>> {
  return requestJson<ContentModel<NotebookModel>>('/api/contents', {
    method: 'POST',
    body: { path, type: 'notebook' },
  });
}

/** Creates an untitled file, directory or notebook inside `parentDir`. */
export function createContent(parentDir: string, type: ContentType): Promise<ContentEntry> {
  return requestJson<ContentEntry>('/api/contents/create', {
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
export function copyContent(from: string, toDir: string): Promise<ContentEntry> {
  return requestJson<ContentEntry>('/api/contents/copy', {
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

export function saveNotebook(path: string, notebook: NotebookModel): Promise<void> {
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
export function uploadFile(request: UploadRequest): Promise<ContentEntry> {
  const form = new FormData();
  form.append('parent_dir', request.parentDir);
  form.append('relative_path', request.relativePath ?? request.file.name);
  if (request.replace === true) {
    form.append('replace', 'true');
  }
  form.append('file', request.file);

  return requestUpload<ContentEntry>('/api/contents/upload', {
    body: form,
    onProgress: request.onProgress,
    signal: request.signal,
  });
}

/** What a project's .editorconfig files say about one file: only the properties they set. */
export interface EditorConfig {
  indent_style?: 'space' | 'tab';
  indent_size?: number;
  tab_width?: number;
  end_of_line?: 'lf' | 'crlf' | 'cr';
  charset?: string;
  trim_trailing_whitespace?: boolean;
  insert_final_newline?: boolean;
}

export function getEditorConfig(path: string): Promise<EditorConfig> {
  return requestJson<EditorConfig>('/api/contents/editorconfig', { query: { path } });
}

/** One replacement in a file, in the Language Server Protocol's own counting: lines and UTF-16 columns. */
export interface FilePosition {
  line: number;
  character: number;
}

export interface FileEdit {
  start: FilePosition;
  end: FilePosition;
  new_text: string;
}

export interface FileEdits {
  path: string;
  edits: FileEdit[];
}

/** What became of one file's edits: how many were applied, or why none were. */
export interface FileEditResult {
  path: string;
  applied?: number;
  error?: string;
}

/**
 * Applies a language server's edits to files no editor holds — the other half of a rename or a quick fix.
 * A file with an editor is edited there instead, where the change is undoable.
 */
export async function applyFileEdits(files: FileEdits[]): Promise<FileEditResult[]> {
  const answer = await requestJson<{ files: FileEditResult[] }>('/api/contents/edits', {
    method: 'POST',
    body: { files },
  });
  return answer.files;
}
