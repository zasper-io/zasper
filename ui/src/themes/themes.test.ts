/*
The registry's invariants, which are the ones no component can check for itself.

A theme is one stored name that has to come apart into the two attributes the stylesheet keys on, and
the failure mode is silent: a name that resolves to a `data-accent` with no ramp behind it, or a stored
name that no longer exists, paints an app with half its colours missing rather than throwing.
*/
import { describe, expect, it } from 'vitest';

import { applyTheme, defaultTheme, getTheme, themes } from '.';

/** The hues in styles/_accents.scss. This list failing is the port having drifted apart. */
const HUES = ['teal', 'blue', 'slate', 'orange'];

describe('the registry', () => {
  it('ships a light and a dark theme for every hue, and nothing else but JupyterLab', () => {
    const generated = HUES.flatMap((hue) => [`${hue}-light`, `${hue}-dark`]);
    expect(themes.map((theme) => theme.id)).toEqual([...generated, 'jupyterlab']);
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
    // The bug this is here for: switching from a hue to JupyterLab and keeping `data-accent`, which
    // hands the light mapping in _accents.scss to a theme that states every one of those tokens
    // itself — a Material palette with a teal topbar in it.
    const root = document.createElement('html');
    applyTheme(getTheme('teal-light'), root);
    applyTheme(getTheme('jupyterlab'), root);

    expect(root.dataset.theme).toBe('jupyterlab');
    expect(root.dataset.accent).toBeUndefined();
  });
});
