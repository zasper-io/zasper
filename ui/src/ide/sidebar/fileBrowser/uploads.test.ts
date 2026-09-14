import { describe, expect, it } from 'vitest';

import { pendingFromDrop, pendingFromFiles } from './uploads';

/** A file as jsdom builds it, which is without the folder path a directory input would fill in. */
function fileNamed(name: string, relativePath = ''): File {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

/** The two shapes of the entry API, cast to what the DOM says they are: a file, and a folder. */
function fileEntry(name: string): FileSystemEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (accept: (file: File) => void) => accept(fileNamed(name)),
  } as unknown as FileSystemEntry;
}

function folderEntry(name: string, batches: FileSystemEntry[][]): FileSystemEntry {
  let asked = 0;
  return {
    name,
    isFile: false,
    isDirectory: true,
    // readEntries answers in batches and reports the end as an empty one.
    createReader: () => ({
      readEntries: (accept: (entries: FileSystemEntry[]) => void) => accept(batches[asked++] ?? []),
    }),
  } as unknown as FileSystemEntry;
}

function dropOf(entries: FileSystemEntry[], files: File[] = []): DataTransfer {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files,
  } as unknown as DataTransfer;
}

describe('pendingFromFiles', () => {
  it('takes the name of a plain file and the path of one inside a chosen folder', () => {
    const files = [fileNamed('notes.txt'), fileNamed('a.txt', 'notes/img/a.txt')];

    expect(pendingFromFiles(files as unknown as FileList).map((one) => one.relativePath)).toEqual([
      'notes.txt',
      'notes/img/a.txt',
    ]);
  });

  it('has nothing to say about a picker that was cancelled', () => {
    expect(pendingFromFiles(null)).toEqual([]);
  });
});

describe('pendingFromDrop', () => {
  it('walks a dropped folder down to its files', async () => {
    const dropped = dropOf([
      folderEntry('notes', [[fileEntry('a.txt'), folderEntry('img', [[fileEntry('logo.png')]])]]),
      fileEntry('loose.txt'),
    ]);

    const pending = await pendingFromDrop(dropped);

    expect(pending.map((one) => one.relativePath).sort()).toEqual([
      'loose.txt',
      'notes/a.txt',
      'notes/img/logo.png',
    ]);
  });

  it('keeps asking a folder for more until it stops giving', async () => {
    const dropped = dropOf([
      folderEntry('notes', [[fileEntry('a.txt')], [fileEntry('b.txt')], []]),
    ]);

    const pending = await pendingFromDrop(dropped);

    // A single readEntries answers with only part of a large folder.
    expect(pending.map((one) => one.relativePath).sort()).toEqual(['notes/a.txt', 'notes/b.txt']);
  });

  it('falls back to the files themselves when nothing was an entry', async () => {
    const dropped = {
      items: [{ webkitGetAsEntry: () => null }],
      files: [fileNamed('notes.txt')],
    } as unknown as DataTransfer;

    expect((await pendingFromDrop(dropped)).map((one) => one.relativePath)).toEqual(['notes.txt']);
  });
});
