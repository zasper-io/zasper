/**
 * What the frontend is allowed to report, and the mapping that makes a value safe to report.
 *
 * The server keeps the same catalogue in internal/analytics/events.go and rejects anything that does
 * not fit it, so this file is a convenience rather than the control: it means a value is mapped once,
 * here, instead of at each call site where somebody could forget. The two lists have to agree — a
 * value only this side knows about is dropped by the server, which is the safe direction to fail.
 */

export type TelemetryEventName =
  | 'notebook_opened'
  | 'file_opened'
  | 'command_executed'
  | 'theme_changed';

export interface TelemetryEvent {
  event: TelemetryEventName;
  properties?: Record<string, string | number | boolean>;
}

/**
 * Extensions worth telling apart, without the dot. Anything else becomes 'other': a file called
 * `q3-forecast-acme.xlsx` says more about the person than about which formats Zasper should support,
 * so the name is mapped onto this list rather than checked against it.
 *
 * Kept in step with fileExtensions in internal/analytics/events.go.
 */
const KNOWN_EXTENSIONS = new Set([
  'ipynb',
  'py',
  'r',
  'jl',
  'go',
  'rs',
  'java',
  'kt',
  'scala',
  'rb',
  'php',
  'swift',
  'js',
  'jsx',
  'ts',
  'tsx',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'html',
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'xml',
  'csv',
  'tsv',
  'parquet',
  'md',
  'rst',
  'txt',
  'tex',
  'sql',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'pdf',
  'lock',
  'env',
  'gitignore',
  'dockerfile',
  'makefile',
]);

/** Names that are the extension, as far as anyone reading the numbers cares. */
const BARE_NAMES = new Set(['dockerfile', 'makefile']);

/**
 * A file name reduced to one of the known extensions, 'none' when it has none, or 'other'.
 */
export function normalizeExtension(name: string): string {
  const base = (name.split('/').pop() ?? '').toLowerCase();
  if (base === '') {
    return 'none';
  }
  if (BARE_NAMES.has(base)) {
    return base;
  }

  const dot = base.lastIndexOf('.');
  // A leading dot is a dotfile, not a separator: `.gitignore` is all extension.
  const extension = dot > 0 ? base.slice(dot + 1) : dot === 0 ? base.slice(1) : '';

  if (extension === '') {
    return 'none';
  }
  return KNOWN_EXTENSIONS.has(extension) ? extension : 'other';
}

/**
 * Command ids are developer-authored constants, never anything a user typed, and this is the shape
 * the server insists on: lowercase, one colon, nothing that could carry a path.
 */
const COMMAND_ID = /^[a-z][a-z0-9]*:[a-z0-9-]{1,32}$/;

export function isReportableCommandId(id: string): boolean {
  return COMMAND_ID.test(id);
}
