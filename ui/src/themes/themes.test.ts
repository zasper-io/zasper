/*
The registry's invariants, which are the ones no component can check for itself.

A theme is one stored name that has to come apart into the two attributes the stylesheet keys on, and
the failure mode is silent: a name that resolves to a `data-accent` with no ramp behind it, or a stored
name that no longer exists, paints an app with half its colours missing rather than throwing.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTheme, defaultTheme, getTheme, rememberTheme, storedTheme, themes } from '.';

/** The hues in styles/_accents.scss. This list failing is the port having drifted apart. */
const HUES = ['teal', 'blue', 'slate', 'orange'];

describe('the registry', () => {
  it('ships a light and a dark theme for every hue, and nothing else', () => {
    const generated = HUES.flatMap((hue) => [`${hue}-light`, `${hue}-dark`]);
    expect(themes.map((theme) => theme.id)).toEqual(generated);
  });

  it('names every theme once', () => {
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(themes.length);
    expect(new Set(themes.map((theme) => theme.label)).size).toBe(themes.length);
  });

  it('gives every theme a polarity, and an accent only where there is a ramp for it', () => {
    for (const theme of themes) {
      expect(theme.theme, theme.id).not.toBe('');
      if (theme.accent !== undefined) {
        expect(HUES, theme.id).toContain(theme.accent);
        // The id has to be readable back apart: it is what the settings panel stores.
        expect(theme.id).toBe(`${theme.accent}-${theme.theme}`);
      }
    }
  });

  it('defaults to teal light', () => {
    expect(defaultTheme.id).toBe('teal-light');
  });
});

describe('getTheme', () => {
  it('resolves a stored name', () => {
    expect(getTheme('orange-dark').id).toBe('orange-dark');
  });

  it('carries the two themes that used to exist over to teal', () => {
    // A config written before the accents existed. The purple those named is now only the fallback in
    // `:root`, so they cannot resolve to themselves.
    expect(getTheme('light').id).toBe('teal-light');
    expect(getTheme('dark').id).toBe('teal-dark');
  });

  it('falls back rather than throwing on a name we no longer ship', () => {
    expect(getTheme('purple-light').id).toBe(defaultTheme.id);
    expect(getTheme('').id).toBe(defaultTheme.id);
  });
});

describe('applyTheme', () => {
  it('writes the hue and the polarity separately', () => {
    const root = document.createElement('html');
    applyTheme(getTheme('slate-dark'), root);

    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.accent).toBe('slate');
  });

  it('leaves no accent behind on a theme that brings its own palette', () => {
    // Every shipped theme is a hue today, so the theme here is built rather than looked up — the
    // branch is still in applyTheme because `accent` is optional, and the bug it guards against is
    // silent: keeping `data-accent` hands the mapping in _accents.scss to a palette that states all
    // of those tokens itself, which paints someone else's greys with a teal topbar in them.
    const ownPalette = { ...getTheme('teal-light'), id: 'own', theme: 'own', accent: undefined };
    const root = document.createElement('html');
    applyTheme(getTheme('teal-light'), root);
    applyTheme(ownPalette, root);

    expect(root.dataset.theme).toBe('own');
    expect(root.dataset.accent).toBeUndefined();
  });
});

// The copy of the config's theme that /login reads, because /login has no config: it renders before
// there is a token to read one with.
describe('the remembered theme', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('comes back as the theme it was stored as', () => {
    rememberTheme('orange-dark');
    expect(storedTheme().id).toBe('orange-dark');
  });

  it('is the default when nothing has been stored, or when what was is gone', () => {
    expect(storedTheme().id).toBe(defaultTheme.id);
    rememberTheme('purple-light');
    expect(storedTheme().id).toBe(defaultTheme.id);
  });

  it('is a cache and not a requirement: neither call throws when storage is unavailable', () => {
    // Private browsing, and a quota that is full. A theme id is not worth a blank page.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(storedTheme().id).toBe(defaultTheme.id);
    expect(() => rememberTheme('blue-dark')).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
