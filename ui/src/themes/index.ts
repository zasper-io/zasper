// The theme registry.
//
// A theme is data, not control flow. Nothing in the app branches on the active
// theme's *name* — the UI chrome resolves through the custom properties in
// styles/_tokens.scss, and the one thing CSS cannot express (CodeMirror's syntax
// highlighting, which is a set of editor extensions) is looked up here.
//
// A theme is stored and shown as one name — `teal-dark` — because the config file
// holds one string (internal/core/config.go). In the stylesheet it is two things:
// `data-accent` picks a nine-step hue ramp and `data-theme` decides which step each
// token takes, so eight themes are four hues × two polarities and no CSS is written
// twice. This file is the seam between the two, and `applyTheme` below is the only
// place that knows how a name comes apart.
//
// To add a hue: nine values in $accents in styles/_accents.scss and one entry in
// HUES. That is two light-and-dark themes, and the settings panel lists them because
// it renders this array.
//
// To add a theme that is not a hue — a palette of somebody else's, as 'jupyterlab'
// is — write a `[data-theme='<id>']` block in styles/_tokens.scss overriding only
// what differs, and append an entry with no `accent`.
//
// Two things to check while you are there, learned from adding 'jupyterlab':
//   - Every foreground token has to clear WCAG AA (4.5:1) against the surfaces it
//     lands on. _tokens.scss notes the pairs that were already tightened for it.
//   - Icons need nothing: they are drawn in `currentColor` (see .z-icon). The one
//     asset with its colour baked in is the topbar wordmark, and a theme picks the
//     file with --z-logo rather than by branching in a component.

import { vscodeLightInit, vscodeDarkInit } from '@uiw/codemirror-theme-vscode';
import type { Extension } from '@codemirror/state';

import { jupyterLabHighlight } from './jupyterlab';

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

// A theme here may not name a font. The vscode themes ship a `fontFamily` in their default
// settings, which createTheme emits as `&.cm-editor .cm-scroller` — three classes, enough to
// beat styles/_codemirror.scss, so no editor ever painted in --z-mono-font-family. Unsetting it
// makes createTheme skip that rule altogether (it is guarded on the value being truthy) and
// leaves the stylesheet as the only place the family is named. `jupyterLabHighlight` sets no
// font for the same reason; don't add one there either.
const noFont = { fontFamily: undefined };

/** The hues, in the order the settings panel lists them. Each one makes two themes. */
const HUES = [
  { accent: 'teal', label: 'Teal' },
  { accent: 'blue', label: 'Blue' },
  { accent: 'slate', label: 'Slate' },
  { accent: 'orange', label: 'Orange' },
];

// Built once and shared by the four themes of each polarity: a CodeMirror theme is a value, and
// the editor's colours are the polarity's rather than the hue's.
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
  // Not a hue: an imitation of JupyterLab's own Material palette, which is a whole set of values
  // rather than a brand colour, so it takes no accent and states everything itself.
  { id: 'jupyterlab', label: 'JupyterLab', theme: 'jupyterlab', codeMirror: jupyterLabHighlight },
];

export const defaultTheme: ZasperTheme = themes[0];

/**
 * What the two themes that used to exist became. A config written by an earlier version says
 * `light` or `dark`, and the purple those named is no longer selectable — it is the fallback in
 * `:root`. Teal because it is the default, so an upgrade lands on the same theme a new install does.
 */
const LEGACY: Record<string, string> = {
  light: 'teal-light',
  dark: 'teal-dark',
};

/**
 * Resolves a persisted theme id. Falls back to the default rather than throwing,
 * so a config file naming a theme that has since been removed still boots.
 */
export function getTheme(id: string): ZasperTheme {
  const wanted = LEGACY[id] ?? id;
  return themes.find((theme) => theme.id === wanted) ?? defaultTheme;
}

/**
 * Publishes a theme to <html>, which is the whole of applying one: every colour in the app resolves
 * through custom properties keyed off these two attributes, so this repaints the UI.
 *
 * `data-accent` is removed rather than emptied for a theme that has none — `[data-accent]` in
 * styles/_accents.scss matches an empty value, and a theme with its own palette must not be handed
 * a mapping written for a ramp it does not have.
 */
export function applyTheme(theme: ZasperTheme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme.theme;
  if (theme.accent === undefined) {
    delete root.dataset.accent;
  } else {
    root.dataset.accent = theme.accent;
  }
}
