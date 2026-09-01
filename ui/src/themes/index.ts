// The theme registry.
//
// A theme is data, not control flow. Nothing in the app branches on the active
// theme's *name* — the UI chrome resolves through the custom properties in
// styles/_tokens.scss, and the one thing CSS cannot express (CodeMirror's syntax
// highlighting, which is a set of editor extensions) is looked up here.
//
// To add a theme:
//   1. Add a `[data-theme='<id>']` block to styles/_tokens.scss overriding only
//      the tokens that differ from the light defaults in `:root`.
//   2. Add an entry below. Reuse an existing `codeMirror` extension if the new
//      theme is a variation on light or dark.
//
// That is the whole contract. No component has to change, and the settings
// panel picks the new theme up automatically because it renders this list.
//
// Two things to check while you are there, learned from adding 'jupyterlab':
//   - Every foreground token has to clear WCAG AA (4.5:1) against the surfaces it
//     lands on. _tokens.scss notes the pairs that were already tightened for it.
//   - A handful of assets under public/images have their colour baked in and are
//     rendered as <img>, so CSS `fill` cannot reach them. Those are selected by
//     token too (--z-logo, --z-filter-chrome-icon, --z-img-icon-filter) rather
//     than by branching in a component.

import { vscodeLight, vscodeDark } from '@uiw/codemirror-theme-vscode';
import type { Extension } from '@codemirror/state';

import { jupyterLabHighlight } from './jupyterlab';

export interface ZasperTheme {
  /** Written to `data-theme` on <html>, and persisted in ~/.zasper/config.json. */
  id: string;
  /** Shown in the settings panel. */
  label: string;
  /** Syntax highlighting for the file editor and notebook cells. */
  codeMirror: Extension;
}

export const themes: ZasperTheme[] = [
  { id: 'light', label: 'Light', codeMirror: vscodeLight },
  { id: 'dark', label: 'Dark', codeMirror: vscodeDark },
  { id: 'jupyterlab', label: 'JupyterLab', codeMirror: jupyterLabHighlight },
];

export const defaultTheme: ZasperTheme = themes[0];

/**
 * Resolves a persisted theme id. Falls back to the default rather than throwing,
 * so a config file naming a theme that has since been removed still boots.
 */
export function getTheme(id: string): ZasperTheme {
  return themes.find((theme) => theme.id === id) ?? defaultTheme;
}
