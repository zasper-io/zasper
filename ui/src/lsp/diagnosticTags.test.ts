import { describe, expect, it } from 'vitest';

import { markForTags } from './servers';

// The protocol's DiagnosticTag: 1 unnecessary, 2 deprecated.
describe('markForTags', () => {
  it('fades what the server tagged unnecessary rather than squiggling it', () => {
    expect(markForTags([1])).toBe('cm-lintRange-unnecessary');
  });

  it('strikes through what it tagged deprecated', () => {
    expect(markForTags([2])).toBe('cm-lintRange-deprecated');
  });

  it('leaves an ordinary diagnostic to its severity', () => {
    expect(markForTags(undefined)).toBeUndefined();
    expect(markForTags([])).toBeUndefined();
  });
});
