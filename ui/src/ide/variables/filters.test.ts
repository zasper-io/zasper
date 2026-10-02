import { describe, expect, it } from 'vitest';

import { displayValue } from './filters';

describe('displayValue', () => {
  it('prints a float to at most six places, as pandas does', () => {
    expect(displayValue(7.166451612903226)).toBe('7.166452');
    expect(displayValue(4.345000000000001)).toBe('4.345');
    expect(displayValue(0.1)).toBe('0.1');
  });

  it('leaves whole numbers, text and booleans as they came', () => {
    expect(displayValue(1240)).toBe('1240');
    expect(displayValue('north')).toBe('north');
    expect(displayValue(true)).toBe('true');
  });
});
