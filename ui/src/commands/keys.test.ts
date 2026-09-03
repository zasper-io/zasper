import { describe, expect, it } from 'vitest';

import { chordMatches, formatChord, isModifierKey, parseChord } from './keys';

const MAC = true;
const OTHER = false;

function keydown(key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...modifiers });
}

describe('parseChord', () => {
  it('maps Mod- to Cmd on mac and Ctrl elsewhere', () => {
    expect(parseChord('Mod-s', MAC)).toMatchObject({ meta: true, ctrl: false, key: 's' });
    expect(parseChord('Mod-s', OTHER)).toMatchObject({ meta: false, ctrl: true, key: 's' });
  });

  it('leaves an explicit Ctrl- as Ctrl on both platforms', () => {
    expect(parseChord('Ctrl-Enter', MAC)).toMatchObject({ ctrl: true, meta: false, key: 'Enter' });
    expect(parseChord('Ctrl-Enter', OTHER)).toMatchObject({
      ctrl: true,
      meta: false,
      key: 'Enter',
    });
  });

  it('reads several prefixes in any order', () => {
    expect(parseChord('Shift-Alt-Mod-p', MAC)).toMatchObject({
      meta: true,
      alt: true,
      shift: true,
      key: 'p',
    });
  });

  // Splitting on '-' would leave this with an empty key name, and Mod-- is a real binding
  // (decrease font size).
  it('keeps - as a key name', () => {
    expect(parseChord('Mod--', MAC)).toMatchObject({ meta: true, key: '-' });
  });
});

describe('chordMatches', () => {
  it('requires every modifier to agree, not just the ones named', () => {
    expect(chordMatches('Mod-s', keydown('s', { metaKey: true }), MAC)).toBe(true);
    expect(chordMatches('Mod-s', keydown('s', { metaKey: true, shiftKey: true }), MAC)).toBe(false);
    expect(chordMatches('Mod-s', keydown('s'), MAC)).toBe(false);
    expect(chordMatches('Mod-s', keydown('s', { ctrlKey: true }), MAC)).toBe(false);
  });

  it('matches a letter chord however the browser cases the key', () => {
    expect(chordMatches('Mod-Shift-p', keydown('P', { metaKey: true, shiftKey: true }), MAC)).toBe(
      true
    );
  });

  it('ignores the shift flag for punctuation, which already encodes it in the key', () => {
    // Cmd+Shift+= arrives as '+'. Both spellings are bound; neither should also test shiftKey.
    expect(chordMatches('Mod-+', keydown('+', { metaKey: true, shiftKey: true }), MAC)).toBe(true);
    expect(chordMatches('Mod-=', keydown('=', { metaKey: true }), MAC)).toBe(true);
    expect(chordMatches('Mod-=', keydown('+', { metaKey: true, shiftKey: true }), MAC)).toBe(false);
  });

  it('distinguishes Shift-Enter from Enter', () => {
    expect(chordMatches('Shift-Enter', keydown('Enter', { shiftKey: true }), MAC)).toBe(true);
    expect(chordMatches('Shift-Enter', keydown('Enter'), MAC)).toBe(false);
  });

  it('reads Ctrl-a as literal Ctrl on mac, where Cmd-a is a different chord', () => {
    expect(chordMatches('Ctrl-a', keydown('a', { ctrlKey: true }), MAC)).toBe(true);
    expect(chordMatches('Ctrl-a', keydown('a', { metaKey: true }), MAC)).toBe(false);
  });
});

describe('formatChord', () => {
  it('writes chords the way the platform does', () => {
    expect(formatChord('Mod-s', MAC)).toBe('⌘S');
    expect(formatChord('Mod-s', OTHER)).toBe('Ctrl+S');
    expect(formatChord('Ctrl-Shift-d', MAC)).toBe('⌃⇧D');
    expect(formatChord('Ctrl-Shift-d', OTHER)).toBe('Ctrl+Shift+D');
  });

  it('uses the mac symbol for a named key, and its name elsewhere', () => {
    expect(formatChord('Shift-Enter', MAC)).toBe('⇧⏎');
    expect(formatChord('Shift-Enter', OTHER)).toBe('Shift+Enter');
    expect(formatChord('Mod-ArrowDown', MAC)).toBe('⌘↓');
  });

  it('spells out a named key that has no settled symbol', () => {
    expect(formatChord('Mod-F5', MAC)).toBe('⌘F5');
    expect(formatChord('Mod-F5', OTHER)).toBe('Ctrl+F5');
  });
});

describe('isModifierKey', () => {
  it('is true only for the modifiers themselves', () => {
    expect(['Shift', 'Control', 'Alt', 'Meta'].every(isModifierKey)).toBe(true);
    expect(['a', 'Enter', 'ArrowUp'].some(isModifierKey)).toBe(false);
  });
});
