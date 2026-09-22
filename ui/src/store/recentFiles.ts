/**
 * The files this project had open, newest first, for the palette's empty query and the Launcher.
 *
 * In localStorage beside the tab strip, and for the same reason: which files someone has been reading
 * belongs to the window looking at the project, not to the server. Nothing here is sent anywhere.
 */
import { atom } from 'jotai';

import { projectEntry, readJSON, withProject, writeJSON } from './projectStorage';

/** A file the reader had open: what it takes to open it again, and what a row shows. */
export interface RecentFile {
  path: string;
  name: string;
  /** `file` or `notebook`, which is what `openTab` needs. */
  type: string;
}

const STORAGE_KEY = 'zasper.recent';

/** Bumped when the record's shape changes; one this code does not know is ignored rather than guessed at. */
const VERSION = 2;

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

/** Version 1 held one project's files; it is read as that project's entry. */
function storedProjects(): unknown {
  const record = readJSON(STORAGE_KEY) as {
    version?: unknown;
    projects?: unknown;
    directory?: unknown;
    files?: unknown;
  } | null;
  if (record === null || typeof record !== 'object') {
    return {};
  }
  if (record.version === VERSION) {
    return record.projects;
  }
  if (record.version === 1 && typeof record.directory === 'string') {
    return { [record.directory]: { files: record.files, used: 0 } };
  }
  return {};
}

export function readRecentFiles(directory: string): RecentFile[] {
  const entry = projectEntry(storedProjects(), directory) as { files?: unknown } | undefined;
  if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.files)) {
    return [];
  }

  return (entry.files as RecentFile[])
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
  writeJSON(STORAGE_KEY, {
    version: VERSION,
    projects: withProject(storedProjects(), directory, {
      files: files.slice(0, KEPT),
      used: Date.now(),
    }),
  });
}
