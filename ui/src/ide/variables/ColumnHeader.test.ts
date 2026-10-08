import { describe, expect, it } from 'vitest';

import { shapeTip } from './ColumnHeader';

describe('shapeTip', () => {
  it("says a number's range, mean and spread, and that nothing is missing", () => {
    expect(
      shapeTip({
        kind: 'number',
        count: 1000,
        missing: 0,
        distinct: null,
        min: 0,
        max: 312.7,
        mean: 3.658432,
        std: 4.81277,
      })
    ).toEqual(['Min 0 · Max 312.7', 'Mean 3.658 · Std dev 4.813', 'None missing']);
  });

  it("says a text column's distinct values, its commonest with their counts, and the missing rows", () => {
    expect(
      shapeTip({
        kind: 'text',
        count: 1000,
        missing: 40,
        distinct: 2,
        top: [
          { value: 'N', count: 958 },
          { value: 'Y', count: 2 },
        ],
      })
    ).toEqual(['2 distinct of 1,000', 'N (958) · Y (2)', '40 of 1,000 rows missing']);
  });
});
