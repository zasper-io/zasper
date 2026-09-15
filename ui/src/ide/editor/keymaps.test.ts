import { describe, expect, it } from 'vitest';

import { lazyKeymap } from './keymaps';

describe('lazyKeymap', () => {
  it('asks for nothing when the editor keeps its own bindings', () => {
    expect(lazyKeymap('default')).toBeNull();
  });

  it('loads the bindings that were chosen', async () => {
    expect(await lazyKeymap('vim')).toBeDefined();
    expect(await lazyKeymap('emacs')).toBeDefined();
  });
});
