/*
Every theme's colours, held to WCAG AA where they meet: 4.5:1 for text, 3:1 for the edges and marks a
control is recognised by (1.4.3, 1.4.11).

The ratios in _accents.scss's comments were measured once and kept nowhere, so a token change could
undo one without anything noticing. Here the real stylesheet is compiled, the cascade is jsdom's, and each
pair is measured in all eight themes. A pair that fails today is listed in KNOWN with the themes it fails
in; it is a todo (todos/accessibility.md), not an exemption, and the test fails once it passes so that
the fix also takes it off the list.
*/
import { join } from 'node:path';
import * as sass from 'sass';
import { beforeAll, describe, expect, it } from 'vitest';

import { themes } from '.';

const TEXT = 4.5;
const NON_TEXT = 3;

/** [foreground, background, minimum]. A translucent background is laid over `--z-bg-panel`. */
const PAIRS: Record<string, [string, string, number]> = {
  'default on panel': ['--z-fg-default', '--z-bg-panel', TEXT],
  'default on app': ['--z-fg-default', '--z-bg-app', TEXT],
  'default on content': ['--z-fg-default', '--z-bg-content', TEXT],
  'default on selected row': ['--z-fg-default', '--z-bg-row-selected', TEXT],
  'default on menu hover': ['--z-fg-default', '--z-bg-menu-hover', TEXT],
  'default on launcher tile': ['--z-fg-default', '--z-bg-launcher-tile', TEXT],
  'default on output': ['--z-fg-default', '--z-bg-cell-output', TEXT],
  'default on modal': ['--z-fg-default', '--z-bg-modal', TEXT],
  'default on overlay': ['--z-fg-default', '--z-bg-overlay', TEXT],
  'editor on editor': ['--z-fg-editor', '--z-bg-editor', TEXT],
  'editor on cell': ['--z-fg-editor', '--z-bg-cell', TEXT],
  'muted on panel': ['--z-fg-muted', '--z-bg-panel', TEXT],
  'muted on notice': ['--z-fg-muted', '--z-bg-notice', TEXT],
  'muted on cell': ['--z-fg-muted', '--z-bg-cell', TEXT],
  'muted on selected row': ['--z-fg-muted', '--z-bg-row-selected', TEXT],
  'muted on menu hover': ['--z-fg-muted', '--z-bg-menu-hover', TEXT],
  'muted on modal': ['--z-fg-muted', '--z-bg-modal', TEXT],
  'subtle on panel': ['--z-fg-subtle', '--z-bg-panel', TEXT],
  'subtle on overlay': ['--z-fg-subtle', '--z-bg-overlay', TEXT],
  'subtle on code': ['--z-fg-subtle', '--z-bg-code', TEXT],
  'subtle on selected row': ['--z-fg-subtle', '--z-bg-row-selected', TEXT],
  'subtle on cell': ['--z-fg-subtle', '--z-bg-cell', TEXT],
  'link on panel': ['--z-fg-accent', '--z-bg-panel', TEXT],
  'link on editor': ['--z-fg-accent', '--z-bg-editor', TEXT],
  'link on output': ['--z-fg-accent', '--z-bg-cell-output', TEXT],
  'link on selected row': ['--z-fg-accent', '--z-bg-row-selected', TEXT],
  'on-accent on accent': ['--z-fg-on-accent', '--z-accent', TEXT],
  'on-accent on accent hover': ['--z-fg-on-accent', '--z-accent-hover', TEXT],
  'on-accent on danger': ['--z-fg-on-accent', '--z-bg-danger', TEXT],
  'on-chrome on topbar': ['--z-fg-on-chrome', '--z-bg-topbar', TEXT],
  'on-chrome on statusbar': ['--z-fg-on-chrome', '--z-bg-statusbar', TEXT],
  'on-chrome on banner': ['--z-fg-on-chrome', '--z-bg-banner', TEXT],
  'on-chrome on modal header': ['--z-fg-on-chrome', '--z-bg-modal-header', TEXT],
  'on-chrome on inactive tab': ['--z-fg-on-chrome', '--z-bg-tab-inactive', TEXT],
  'on-chrome on active tab': ['--z-fg-on-chrome', '--z-bg-tab-active', TEXT],
  'field on field': ['--z-fg-field', '--z-bg-field', TEXT],
  'placeholder on field': ['--z-fg-placeholder', '--z-bg-field', TEXT],
  'placeholder on panel': ['--z-fg-placeholder', '--z-bg-panel', TEXT],
  'placeholder on modal': ['--z-fg-placeholder', '--z-bg-modal', TEXT],
  'serial number on cell': ['--z-fg-serial-no', '--z-bg-cell', TEXT],
  'error on panel': ['--z-status-error', '--z-bg-panel', TEXT],
  'error on notice': ['--z-status-error', '--z-bg-notice', TEXT],
  'error on error fill': ['--z-status-error', '--z-bg-error-subtle', TEXT],
  'warning on panel': ['--z-status-warning', '--z-bg-panel', TEXT],
  'git added on panel': ['--z-git-added', '--z-bg-panel', TEXT],
  'git modified on panel': ['--z-git-modified', '--z-bg-panel', TEXT],
  'git deleted on panel': ['--z-git-deleted', '--z-bg-panel', TEXT],
  'git conflict on panel': ['--z-git-conflict', '--z-bg-panel', TEXT],
  'git added on selected row': ['--z-git-added', '--z-bg-row-selected', TEXT],
  'git modified on selected row': ['--z-git-modified', '--z-bg-row-selected', TEXT],
  'icon on panel': ['--z-fg-icon', '--z-bg-panel', NON_TEXT],
  'field border on panel': ['--z-border-field', '--z-bg-panel', NON_TEXT],
  'field border on modal': ['--z-border-field', '--z-bg-modal', NON_TEXT],
  'strong border on panel': ['--z-border-strong', '--z-bg-panel', NON_TEXT],
  'accent on panel': ['--z-accent', '--z-bg-panel', NON_TEXT],
  'accent on cell': ['--z-accent', '--z-bg-cell', NON_TEXT],
  // The focus ring (styles/_base.scss) against what a control sits on. Chrome surfaces restate it as
  // --z-fg-on-chrome, which the on-chrome text pairs above already hold at 4.5.
  'focus ring on panel': ['--z-focus-ring', '--z-bg-panel', NON_TEXT],
  'focus ring on app': ['--z-focus-ring', '--z-bg-app', NON_TEXT],
  'focus ring on content': ['--z-focus-ring', '--z-bg-content', NON_TEXT],
  'focus ring on editor': ['--z-focus-ring', '--z-bg-editor', NON_TEXT],
  'focus ring on cell': ['--z-focus-ring', '--z-bg-cell', NON_TEXT],
  'focus ring on output': ['--z-focus-ring', '--z-bg-cell-output', NON_TEXT],
  'focus ring on modal': ['--z-focus-ring', '--z-bg-modal', NON_TEXT],
  'focus ring on overlay': ['--z-focus-ring', '--z-bg-overlay', NON_TEXT],
  'focus ring on launcher tile': ['--z-focus-ring', '--z-bg-launcher-tile', NON_TEXT],
  'focus ring on selected row': ['--z-focus-ring', '--z-bg-row-selected', NON_TEXT],
  'focus ring on menu hover': ['--z-focus-ring', '--z-bg-menu-hover', NON_TEXT],
  // The open file's row is filled with the accent, and the ring there is drawn inside it.
  'tree focus ring on open row': ['--z-fg-on-accent', '--z-accent', NON_TEXT],
  'active rail mark on panel': ['--z-border-navbutton-active', '--z-bg-panel', NON_TEXT],
  'kernel idle on statusbar': ['--z-status-idle', '--z-bg-statusbar', NON_TEXT],
  'kernel busy on statusbar': ['--z-status-busy', '--z-bg-statusbar', NON_TEXT],
  'kernel idle on panel': ['--z-status-idle', '--z-bg-panel', NON_TEXT],
  'kernel busy on panel': ['--z-status-busy', '--z-bg-panel', NON_TEXT],
  'scrollbar thumb on track': ['--z-scrollbar-thumb', '--z-scrollbar-track', NON_TEXT],
};

/** The terminal's sixteen, read inside `.terminalContainer`, which gives them a set of their own. */
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].flatMap(
  (hue) => [hue, `bright-${hue}`]
);

const ALL = 'every theme';
const LIGHT = themes.filter((t) => t.theme === 'light').map((t) => t.id);
const DARK = themes.filter((t) => t.theme === 'dark').map((t) => t.id);
const CHROME_HUES = [
  'teal-light',
  'teal-dark',
  'blue-light',
  'blue-dark',
  'orange-light',
  'orange-dark',
];

/** Measured on 4 November 2026. Each is in todos/accessibility.md, Phase 4. */
const KNOWN: Record<string, string[] | typeof ALL> = {
  'muted on notice': LIGHT,
  'muted on selected row': LIGHT,
  'muted on menu hover': DARK,
  'subtle on code': ALL,
  'subtle on selected row': ALL,
  'subtle on cell': ALL,
  'link on selected row': ['orange-light'],
  'git deleted on panel': DARK,
  'git added on selected row': LIGHT,
  'git modified on selected row': LIGHT,
  'field border on panel': ALL,
  'field border on modal': ALL,
  'strong border on panel': ALL,
  'accent on panel': DARK,
  'accent on cell': DARK,
  'kernel idle on statusbar': CHROME_HUES,
  'kernel busy on statusbar': CHROME_HUES,
  'scrollbar thumb on track': DARK,
  ...Object.fromEntries(
    [
      'black',
      'bright-black',
      'red',
      'bright-red',
      'blue',
      'bright-blue',
      'magenta',
      'bright-magenta',
      'cyan',
    ].map((hue) => [`terminal ansi ${hue}`, ['orange-light']])
  ),
};

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parse(value: string, lookup: (name: string) => string, depth = 0): Rgba {
  const v = value.trim();
  if (depth > 20) {
    throw new Error(`a var() loop through ${v}`);
  }
  const ref = v.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
  if (ref) {
    return parse(lookup(ref[1]) || ref[2] || 'transparent', lookup, depth + 1);
  }
  if (v === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (v === 'white') {
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  if (v === 'black') {
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length <= 4) {
      h = [...h].map((c) => c + c).join('');
    }
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const [r, g, b, a = 1] = rgb[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r, g, b, a };
  }
  const mix = v.match(/^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/);
  if (mix) {
    const x = parse(mix[1], lookup, depth + 1);
    const w = Number(mix[2]) / 100;
    const y = parse(mix[3], lookup, depth + 1);
    const a = x.a * w + y.a * (1 - w);
    const channel = (k: 'r' | 'g' | 'b') =>
      a === 0 ? 0 : (x[k] * x.a * w + y[k] * y.a * (1 - w)) / a;
    return { r: channel('r'), g: channel('g'), b: channel('b'), a };
  }
  throw new Error(`cannot read ${v} as a colour`);
}

function over(top: Rgba, under: Rgba): Rgba {
  const mixed = (k: 'r' | 'g' | 'b') => top[k] * top.a + under[k] * (1 - top.a);
  return { r: mixed('r'), g: mixed('g'), b: mixed('b'), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(x: Rgba, y: Rgba): number {
  const [light, dark] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (light + 0.05) / (dark + 0.05);
}

/** A theme's ratio for every pair, by pair name. */
function measure(themeId: string): Record<string, number> {
  const theme = themes.find((t) => t.id === themeId)!;
  const root = document.documentElement;
  root.dataset.theme = theme.theme;
  root.dataset.accent = theme.accent;
  const terminal = document.querySelector('.terminalContainer')!;
  const rootStyle = getComputedStyle(root);
  const terminalStyle = getComputedStyle(terminal);
  // jsdom applies a custom property where it is declared and does not inherit it, so a lookup that
  // misses on the terminal falls back to the root, as the browser's inheritance would.
  const onRoot = (name: string) => rootStyle.getPropertyValue(name).trim();
  const onTerminal = (name: string) => terminalStyle.getPropertyValue(name).trim() || onRoot(name);

  const contrast = (fg: string, bg: string, lookup: (name: string) => string) => {
    const base = parse(`var(--z-bg-panel)`, onRoot);
    const ground = over(parse(`var(${bg})`, lookup), base);
    return ratio(over(parse(`var(${fg})`, lookup), ground), ground);
  };

  const out: Record<string, number> = {};
  for (const [name, [fg, bg]] of Object.entries(PAIRS)) {
    out[name] = contrast(fg, bg, onRoot);
  }
  out['terminal text'] = contrast('--z-fg-on-terminal', '--z-bg-terminal', onTerminal);
  for (const hue of ANSI) {
    out[`terminal ansi ${hue}`] = contrast(`--z-ansi-${hue}`, '--z-bg-terminal', onTerminal);
  }
  return out;
}

function minimum(name: string): number {
  return PAIRS[name]?.[2] ?? TEXT;
}

beforeAll(() => {
  const css = sass.compileString("@use 'tokens'; @use 'accents';", {
    loadPaths: [join(__dirname, '..', 'styles')],
  }).css;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const terminal = document.createElement('div');
  terminal.className = 'terminalContainer';
  document.body.append(terminal);
});

describe('theme contrast', () => {
  it('measures a colour in every pair, in every theme', () => {
    for (const theme of themes) {
      for (const [name, value] of Object.entries(measure(theme.id))) {
        expect(value, `${theme.id}: ${name}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it.each(themes.map((t) => t.id))('%s meets AA where it is not a known failure', (id) => {
    const failing = Object.entries(measure(id))
      .filter(([name, value]) => value < minimum(name))
      .filter(([name]) => {
        const known = KNOWN[name];
        return !(known === ALL || known?.includes(id));
      })
      .map(([name, value]) => `${name}: ${value.toFixed(2)} (needs ${minimum(name)})`);
    expect(failing).toEqual([]);
  });

  it('lists only pairs that still fail', () => {
    const passing: string[] = [];
    for (const [name, known] of Object.entries(KNOWN)) {
      const ids = known === ALL ? themes.map((t) => t.id) : known;
      for (const id of ids) {
        const value = measure(id)[name];
        if (value === undefined) {
          passing.push(`${name}: no such pair`);
        } else if (value >= minimum(name)) {
          passing.push(`${name} in ${id}: ${value.toFixed(2)}, take it out of KNOWN`);
        }
      }
    }
    expect(passing).toEqual([]);
  });
});
