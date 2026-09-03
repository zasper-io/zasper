import { describe, expect, it } from 'vitest';

import { describeEntry, formatSize, formatWhen, rowClassName } from './entryDetails';
import { IContentEntry } from '@/api';

function entry(overrides: Partial<IContentEntry>): IContentEntry {
  return { name: 'notes.txt', path: 'docs/notes.txt', type: 'file', content: [], ...overrides };
}

describe('formatSize', () => {
  it('scales to a unit that keeps the number short', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(940)).toBe('940 B');
    expect(formatSize(1200)).toBe('1.2 kB');
    expect(formatSize(15_300_000)).toBe('15 MB');
  });

  it('stops at the largest unit it knows rather than inventing one', () => {
    expect(formatSize(1e18)).toBe('1000000 TB');
  });
});

describe('formatWhen', () => {
  it('answers with nothing when the server sent nothing usable', () => {
    expect(formatWhen(undefined)).toBe('');
    expect(formatWhen('')).toBe('');
    expect(formatWhen('not a date')).toBe('');
  });

  it('reads a server timestamp', () => {
    expect(formatWhen('2026-01-02T03:04:05Z')).toContain('2026');
  });
});

describe('describeEntry', () => {
  it('leads with the path, which the row itself cannot show', () => {
    expect(describeEntry(entry({}))).toBe('docs/notes.txt');
  });

  it('adds whatever else the listing knows', () => {
    const description = describeEntry(
      entry({ size: 2048, last_modified: '2026-01-02T03:04:05Z', writable: false, ignored: true })
    );

    expect(description).toContain('2 kB');
    expect(description).toContain('modified');
    expect(description).toContain('read-only');
    expect(description).toContain('ignored by git');
  });

  it("leaves out a directory's own size, which says nothing about what is in it", () => {
    expect(describeEntry(entry({ type: 'directory', path: 'src', size: 96 }))).toBe('src');
  });
});

describe('rowClassName', () => {
  it('marks the tab in front and what git ignores', () => {
    expect(rowClassName(entry({}), false)).toBe('');
    expect(rowClassName(entry({}), true)).toBe('active');
    expect(rowClassName(entry({ ignored: true }), true)).toBe('active is-ignored');
  });
});
