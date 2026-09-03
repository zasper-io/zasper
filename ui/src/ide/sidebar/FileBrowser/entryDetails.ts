// What a row can say about its entry beyond the name. All of it was already in the listing and
// thrown away: the server has sent size, dates and writability all along.

import { IContentEntry } from '@/api';

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'];

/** Bytes as something short enough for a tooltip: `0 B`, `940 B`, `1.2 kB`, `15 MB`. */
export function formatSize(bytes: number): string {
  let size = bytes;
  let unit = 0;
  while (size >= 1000 && unit < UNITS.length - 1) {
    size /= 1000;
    unit += 1;
  }

  // One decimal below ten, none above: `1.2 MB` is worth reading, `15.3 MB` is noise.
  const rounded = unit === 0 || size >= 10 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}

/** A timestamp in the reader's own locale, or '' when the server sent nothing usable. */
export function formatWhen(iso: string | undefined): string {
  if (iso === undefined || iso === '') {
    return '';
  }
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleString();
}

/** The row's tooltip: the full path, and whatever else is known about the entry. */
export function describeEntry(entry: IContentEntry): string {
  const parts = [entry.path];

  // A directory's size is the size of the directory itself, which means nothing to a reader.
  if (entry.type !== 'directory' && entry.size !== undefined) {
    parts.push(formatSize(entry.size));
  }
  const modified = formatWhen(entry.last_modified);
  if (modified !== '') {
    parts.push(`modified ${modified}`);
  }
  if (entry.writable === false) {
    parts.push('read-only');
  }
  if (entry.ignored === true) {
    parts.push('ignored by git');
  }

  return parts.join(' · ');
}

/**
 * The state a row wears: which tab is in front, what the next action applies to, and whether git
 * would ignore the entry. Read-only is not among them — the lock glyph on the row says that, and
 * saying it twice is two things to keep in step.
 */
export function rowClassName(entry: IContentEntry, isActive: boolean, isSelected = false): string {
  return [
    isActive ? 'active' : '',
    isSelected ? 'is-selected' : '',
    entry.ignored === true ? 'is-ignored' : '',
  ]
    .filter((name) => name !== '')
    .join(' ');
}
