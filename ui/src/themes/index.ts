// The theme registry: a theme is data, and nothing in the app branches on its name.
//
// One stored name — `teal-dark` — is two attributes on <html>: `data-accent` picks a nine-step hue
// ramp and `data-theme` decides which step each token takes, so eight themes are four hues × two
// polarities. `applyTheme` is the only place that knows how a name comes apart.
//
// Adding a hue is nine values in $accents (styles/_accents.scss) and an entry in HUES. A theme with a
// palette of its own instead sets no `accent` and writes its own `[data-theme='<id>']` block; every
// foreground token in it has to clear WCAG AA against the surfaces it lands on.

import { vscodeLightInit, vscodeDarkInit } from '@uiw/codemirror-theme-vscode';
import type { Extension } from '@codemirror/state';

export interface ZasperTheme {
  /** The name the theme is stored under in ~/.zasper/config.json. */
  id: string;
  /** Shown in the settings panel. */
  label: string;
  /** Written to `data-theme` on <html>: which end of the ramp each token takes. */
  theme: string;
  /** Written to `data-accent`. Absent for a theme that brings its own palette. */
  accent?: string;
  /** Syntax highlighting for the file editor and notebook cells. */
  codeMirror: Extension;
}

// No theme may name a font: the vscode themes' own `fontFamily` outweighs styles/_codemirror.scss,
// and unsetting it makes createTheme skip the rule entirely.
const noFont = { fontFamily: undefined };

/** The hues, in the order the settings panel lists them. Each one makes two themes. */
const HUES = [
  { accent: 'teal', label: 'Teal' },
  { accent: 'blue', label: 'Blue' },
  { accent: 'slate', label: 'Slate' },
  { accent: 'orange', label: 'Orange' },
];

// Shared by the four themes of each polarity: the editor's colours are the polarity's, not the hue's.
const MODES = [
  { theme: 'light', label: 'Light', codeMirror: vscodeLightInit({ settings: noFont }) },
  { theme: 'dark', label: 'Dark', codeMirror: vscodeDarkInit({ settings: noFont }) },
];

export const themes: ZasperTheme[] = [
  ...HUES.flatMap((hue) =>
    MODES.map((mode) => ({
      id: `${hue.accent}-${mode.theme}`,
      label: `${hue.label} ${mode.label}`,
      theme: mode.theme,
      accent: hue.accent,
      codeMirror: mode.codeMirror,
    }))
  ),
];

export const defaultTheme: ZasperTheme = themes[0];

/** What an older config's `light` and `dark` resolve to, so an upgrade lands where a new install does. */
const LEGACY: Record<string, string> = {
  light: 'teal-light',
  dark: 'teal-dark',
};

/** Falls back rather than throwing: a config naming a theme we no longer ship still boots. */
export function getTheme(id: string): ZasperTheme {
  const wanted = LEGACY[id] ?? id;
  return themes.find((theme) => theme.id === wanted) ?? defaultTheme;
}

/**
 * Publishes a theme to <html>, which is the whole of applying one.
 *
 * `data-accent` is removed rather than emptied: `[data-accent]` matches an empty value, and a theme
 * with its own palette must not take a mapping written for a ramp it does not have.
 */
export function applyTheme(theme: ZasperTheme, root: HTMLElement = document.documentElement): void {
  withoutTransitions(root, () => {
    root.dataset.theme = theme.theme;
    if (theme.accent === undefined) {
      delete root.dataset.accent;
    } else {
      root.dataset.accent = theme.accent;
    }
  });
}

/**
 * Makes `change` take effect without anything animating its way there: a theme rewrites every colour
 * at once, and `a`'s hover transition (styles/_base.scss) faded the file tree's rows for 300ms.
 *
 * Reading `offsetHeight` is the trick — it recalculates style while `data-theme-switching` is still
 * set, so the new colours are computed with transitions off and none can start.
 */
function withoutTransitions(root: HTMLElement, change: () => void): void {
  root.dataset.themeSwitching = '';
  change();
  void root.offsetHeight;
  delete root.dataset.themeSwitching;
}

/**
 * A copy of the chosen theme the app can read without a request. /login has no config to read at
 * all, and the IDE would otherwise paint the default until `GET /api/config` answered.
 */
const STORAGE_KEY = 'zasper.theme';

/** The last theme this browser applied, or the default. Never throws: a theme id is not worth a boot. */
export function storedTheme(): ZasperTheme {
  try {
    return getTheme(localStorage.getItem(STORAGE_KEY) ?? '');
  } catch {
    return defaultTheme;
  }
}

export function rememberTheme(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing, or a full quota. The config file is still the record; this is only a cache.
  }
}
