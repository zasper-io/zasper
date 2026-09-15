/**
 * The files this project had open, newest first, for the palette's empty query and the Launcher.
 *
 * In localStorage beside the tab strip, and for the same reason: which files someone has been reading
 * belongs to the window looking at the project, not to the server. Nothing here is sent anywhere.
 */
import { atom } from 'jotai';

/** A file the reader had open: what it takes to open it again, and what a row shows. */
export interface RecentFile {
  path: string;
  name: string;
  /** `file` or `notebook`, which is what `openTab` needs. */
  type: string;
}

const STORAGE_KEY = 'zasper.recent';

/** Bumped when the record's shape changes; an older or newer one is ignored rather than guessed at. */
const VERSION = 1;

/** How many are kept. Six are shown at a time; the rest are what is left when those are closed. */
const KEPT = 20;

export const recentFilesAtom = atom<RecentFile[]>([]);

/** `files` with `opened` at the front, once, and the oldest dropped. */
export function withRecent(files: RecentFile[], opened: RecentFile): RecentFile[] {
  return [opened, ...files.filter((file) => file.path !== opened.path)].slice(0, KEPT);
}

/** What was remembered, behind what this session has opened already. */
export function mergedRecent(current: RecentFile[], stored: RecentFile[]): RecentFile[] {
  const seen = new Set(current.map((file) => file.path));
  return [...current, ...stored.filter((file) => !seen.has(file.path))].slice(0, KEPT);
}

/** The folder a recent file is in, and nothing for one in the project root. */
export function folderOf(file: RecentFile): string {
  return file.path === file.name ? '' : file.path.slice(0, -(file.name.length + 1));
}

interface StoredRecentFiles {
  version: number;
  /** The project these paths are in, so another project's files are not offered. */
  directory: string;
  files: RecentFile[];
}

export function readRecentFiles(directory: string): RecentFile[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage turned off.
    return [];
  }
  if (raw === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const record = parsed as Partial<StoredRecentFiles>;
  if (
    record === null ||
    typeof record !== 'object' ||
    record.version !== VERSION ||
    record.directory !== directory ||
    !Array.isArray(record.files)
  ) {
    return [];
  }

  return record.files
    .filter(
      (file): file is RecentFile =>
        file !== null &&
        typeof file === 'object' &&
        typeof file.path === 'string' &&
        file.path !== '' &&
        typeof file.name === 'string' &&
        (file.type === 'file' || file.type === 'notebook')
    )
    .slice(0, KEPT);
}

export function rememberRecentFiles(directory: string, files: RecentFile[]): void {
  const record: StoredRecentFiles = { version: VERSION, directory, files: files.slice(0, KEPT) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // A full or blocked store is not worth failing anything over.
  }
}
