import { describe, expect, it } from 'vitest';

import { cellLanguageOf } from './useCellLanguage';

describe('cellLanguageOf', () => {
  it('takes the running kernel’s codemirror_mode first', () => {
    expect(cellLanguageOf([{ name: 'ipython', version: 3 }, 'python', 'python'])).toBe('python');
    expect(cellLanguageOf(['text/x-c++src', 'C++', 'cpp'])).toBe('c++');
  });

  // xeus-cpp's kernelspec says `cpp`, which the language server did not know as C++.
  it('names a language as CodeMirror does, whatever the kernel calls it', () => {
    expect(cellLanguageOf([undefined, undefined, 'cpp'])).toBe('c++');
    expect(cellLanguageOf(['C++17'])).toBe('c++');
    expect(cellLanguageOf(['C23'])).toBe('c');
    expect(cellLanguageOf(['bash'])).toBe('shell');
    expect(cellLanguageOf(['R'])).toBe('r');
  });

  it('passes over a name nothing knows for one further down', () => {
    expect(cellLanguageOf(['', 'not-a-language', 'julia'])).toBe('julia');
  });

  it('keeps a name nothing knows, for its cells to be plain text', () => {
    expect(cellLanguageOf([undefined, 'brainfrick'])).toBe('brainfrick');
  });

  it('says nothing when nothing does', () => {
    expect(cellLanguageOf([undefined, null, ''])).toBeUndefined();
  });
});
