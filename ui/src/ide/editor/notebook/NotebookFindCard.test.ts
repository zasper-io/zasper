import { describe, expect, it } from 'vitest';

import { notebookCountLabel, notebookFindNote } from './NotebookFindCard';
import { NO_FIND, NotebookFind } from './useNotebookFind';

function find(over: Partial<NotebookFind> = {}): NotebookFind {
  return {
    options: { ...NO_FIND, search: 'frame' },
    query: null,
    setOptions: () => {},
    matches: [],
    current: 0,
    inOutputs: 0,
    skippedRendered: 0,
    broken: false,
    next: () => {},
    previous: () => {},
    replaceCurrent: () => {},
    replaceAll: () => {},
    ...over,
  };
}

const match = { cellId: 'a', index: 0, where: 'source' as const, from: 0, to: 5 };

describe('what the notebook card says beside its field', () => {
  it('says nothing until something is typed', () => {
    expect(notebookCountLabel(find({ options: NO_FIND }))).toBe('');
  });

  it('counts the whole notebook, from the first match before a step', () => {
    expect(notebookCountLabel(find({ matches: [match, match, match] }))).toBe('1 of 3');
    expect(notebookCountLabel(find({ matches: [match, match, match], current: 2 }))).toBe('2 of 3');
  });

  it('tells a pattern that cannot be read from one that finds nothing', () => {
    expect(notebookCountLabel(find({ broken: true }))).toBe('Bad pattern');
    expect(notebookCountLabel(find())).toBe('No results');
  });
});

describe('what the notebook card says its count is hiding', () => {
  it('says how many matches cannot be replaced, in the singular and the plural', () => {
    expect(notebookFindNote(find({ inOutputs: 1 }))).toBe(
      '1 of these is in an output, and cannot be replaced.'
    );
    expect(notebookFindNote(find({ inOutputs: 3 }))).toBe(
      '3 of these are in outputs, and cannot be replaced.'
    );
  });

  // Said even before anything is typed: which cells a search will not look in is worth knowing first.
  it('says how many rendered markdown cells were not searched', () => {
    expect(notebookFindNote(find({ options: NO_FIND, skippedRendered: 2 }))).toBe(
      '2 rendered markdown cells were not searched.'
    );
  });

  it('says both at once, and nothing when there is nothing to say', () => {
    expect(notebookFindNote(find({ inOutputs: 1, skippedRendered: 1 }))).toBe(
      '1 of these is in an output, and cannot be replaced. 1 rendered markdown cell was not searched.'
    );
    expect(notebookFindNote(find())).toBe('');
  });
});
