// Turning what the browser hands over — a file input's list, or a drop from the desktop — into files
// with the paths they should take inside the destination folder. Kept out of the components because
// the drop side is a recursive walk over an API that has to be used before the event returns.

import { joinPath } from '@/paths';

export interface IPendingUpload {
  file: File;
  /** Where the file goes inside the destination folder: its own name, or its path within a folder. */
  relativePath: string;
}

/** What a file input collected, keeping the folder structure when the input asked for a folder. */
export function pendingFromFiles(files: FileList | null): IPendingUpload[] {
  return Array.from(files ?? []).map((file) => ({
    file,
    // webkitRelativePath is filled in only for a folder chosen through a webkitdirectory input.
    relativePath: file.webkitRelativePath === '' ? file.name : file.webkitRelativePath,
  }));
}

/**
 * What was dropped in from the desktop. `dataTransfer.files` is not enough: a dropped folder appears
 * there as a File that cannot be read, so the item list is walked instead, which is the only way to
 * see inside one.
 *
 * The items are taken before the first await on purpose — the list is emptied as soon as the drop
 * event returns, so anything read later reads nothing.
 */
export function pendingFromDrop(transfer: DataTransfer): Promise<IPendingUpload[]> {
  const entries = Array.from(transfer.items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length === 0) {
    // Nothing the entry API recognises. A plain file drop is still a file drop.
    return Promise.resolve(pendingFromFiles(transfer.files));
  }
  return collect(entries, '');
}

async function collect(entries: FileSystemEntry[], prefix: string): Promise<IPendingUpload[]> {
  const found = await Promise.all(entries.map((entry) => walk(entry, prefix)));
  return found.flat();
}

async function walk(entry: FileSystemEntry, prefix: string): Promise<IPendingUpload[]> {
  const relativePath = joinPath(prefix, entry.name);
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    return [{ file, relativePath }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  return collect(await readAll(reader), relativePath);
}

/** readEntries answers in batches and reports the end as an empty one, so it has to be asked until
 *  it stops giving. */
async function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      return all;
    }
    all.push(...batch);
  }
}
