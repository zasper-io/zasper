/** A file's language as a language server is told it, and which server serves it. */
export interface ServerLanguage {
  /** The server's key: `/ws/lsp/{server}`, and the language ids the backend lists. */
  server: string;
  /** The LSP language id for the document. */
  languageId: string;
}

const BY_EXTENSION: Record<string, ServerLanguage> = {
  go: { server: 'go', languageId: 'go' },
  py: { server: 'python', languageId: 'python' },
  ts: { server: 'typescript', languageId: 'typescript' },
  mts: { server: 'typescript', languageId: 'typescript' },
  cts: { server: 'typescript', languageId: 'typescript' },
  tsx: { server: 'typescript', languageId: 'typescriptreact' },
  js: { server: 'typescript', languageId: 'javascript' },
  mjs: { server: 'typescript', languageId: 'javascript' },
  cjs: { server: 'typescript', languageId: 'javascript' },
  jsx: { server: 'typescript', languageId: 'javascriptreact' },
  rs: { server: 'rust', languageId: 'rust' },
  c: { server: 'c', languageId: 'c' },
  h: { server: 'c', languageId: 'c' },
  cc: { server: 'c', languageId: 'cpp' },
  cpp: { server: 'c', languageId: 'cpp' },
  cxx: { server: 'c', languageId: 'cpp' },
  hpp: { server: 'c', languageId: 'cpp' },
  r: { server: 'r', languageId: 'r' },
  jl: { server: 'julia', languageId: 'julia' },
};

/** The server language for a file name, or null for a file no server Zasper knows serves. */
export function serverLanguageFor(fileName: string): ServerLanguage | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) {
    return null;
  }
  return BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

/** The `file://` URI a project-relative path has, under the project's absolute root. */
export function fileUri(root: string, path: string): string {
  const joined = `${root.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return `file://${encodeURI(joined.startsWith('/') ? joined : `/${joined}`)}`;
}

/** The project-relative path of a `file://` URI under root, or null for a file outside the project. */
export function pathOfUri(root: string, uri: string): string | null {
  if (!uri.startsWith('file://')) {
    return null;
  }
  const absolute = decodeURI(uri.slice('file://'.length));
  const base = root.replace(/\/+$/, '');
  const normalised = base.startsWith('/') ? base : `/${base}`;
  if (!absolute.startsWith(`${normalised}/`)) {
    return null;
  }
  return absolute.slice(normalised.length + 1);
}

/** A kernel's language, as `language_info.name` spells it, to the extension its source files have. */
const KERNEL_EXTENSIONS: Record<string, string> = {
  python: 'py',
  r: 'r',
  julia: 'jl',
  go: 'go',
  rust: 'rs',
  typescript: 'ts',
  javascript: 'js',
  c: 'c',
  'c++': 'cpp',
};

/** The server for a notebook's cells, with the extension its virtual document is named with. */
export function notebookLanguageFor(
  kernelLanguage: string | undefined
): { language: ServerLanguage; extension: string } | null {
  const extension =
    KERNEL_EXTENSIONS[(kernelLanguage ?? 'python').trim().toLowerCase() || 'python'];
  const language = extension === undefined ? null : BY_EXTENSION[extension];
  return language == null ? null : { language, extension };
}
