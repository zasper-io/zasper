import { CompletionResult } from '@codemirror/autocomplete';
import { describe, expect, it } from 'vitest';

import { completionAsks, mergeCompletions } from './cellIntelligence';

const kernel: CompletionResult = {
  from: 3,
  options: [{ label: 'head', type: 'method' }, { label: 'shape' }],
  validFor: /^[\w.]*$/,
};
const server: CompletionResult = {
  from: 3,
  options: [
    { label: 'shape', type: 'property', detail: 'tuple[int, int]' },
    { label: 'hist', type: 'method' },
  ],
};

describe('mergeCompletions', () => {
  // The tag is there because a reader cannot otherwise tell a name that exists in the kernel
  // now from one the source defines in a cell that has not run.
  it("lists the kernel's names first, with what the server knows about them, then the server's own", () => {
    const merged = mergeCompletions(kernel, server);

    expect(merged?.options).toEqual([
      { label: 'head', type: 'method', origin: 'kernel' },
      {
        label: 'shape',
        type: 'property',
        detail: 'tuple[int, int]',
        info: undefined,
        origin: 'kernel',
      },
      { label: 'hist', type: 'method', origin: 'source' },
    ]);
    expect(merged?.validFor).toBe(kernel.validFor);
  });

  it("takes the kernel's answer alone when the two disagree about what is being completed", () => {
    expect(mergeCompletions(kernel, { ...server, from: 0 })).toBe(kernel);
  });

  // Untagged: with one answer there is nothing to tell apart, and `source` on a name the kernel was
  // never asked about would be a claim about the kernel.
  it('takes whichever answered when only one did, and tags nothing', () => {
    expect(mergeCompletions(null, server)).toBe(server);
    expect(mergeCompletions(kernel, null)).toBe(kernel);
    expect(mergeCompletions(null, null)).toBeNull();
  });
});

describe('completionAsks', () => {
  it('asks only the server while typing', () => {
    expect(completionAsks(false, false, true)).toEqual({ kernel: false, server: true });
  });

  it('asks the kernel as well on Tab or Ctrl-Space, busy or not', () => {
    expect(completionAsks(true, false, false)).toEqual({ kernel: true, server: true });
  });

  it('asks the kernel after a dot only while it is idle', () => {
    expect(completionAsks(false, true, true).kernel).toBe(true);
    expect(completionAsks(false, true, false).kernel).toBe(false);
  });
});
