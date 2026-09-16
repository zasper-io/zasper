import { getTheme } from '@/themes';

/*
The colours an exported page is drawn in.

An export is always **teal light**, whatever theme the editor is in. Two decisions in one: light,
because the file is for someone else and is as likely to be printed as read; and Zasper's own default
hue rather than the reader's, because an exported page is the project's design rather than a record of
one person's settings — two people exporting the same notebook should hand over the same-looking file.

That is a problem for the chrome colours, because the tokens in `styles/_tokens.scss` only exist as
computed values on a live element, and on an orange dark theme the live values are orange and dark.

So they are read from a probe: an element carrying `teal-light`'s own two attributes, attached
offscreen for one frame. `_accents.scss` keys the whole ramp off `data-theme` and `data-accent`, so the
probe resolves exactly what a teal light window would, without the app repainting and without this
folder keeping a second copy of the palette. Nothing here is a colour — the only literals are token
names and the theme's id.

The code colours come from somewhere else entirely, and they have to: CodeMirror's highlighting is a set
of editor extensions, not CSS, so there is no token to read. `exportHighlight.ts` generates its rules
from `vscodeLightStyle` — the same array `themes/index.ts` hands to the editor.
*/

/**
 * The theme an exported page is drawn in, by the id `themes/index.ts` stores it under. Named once
 * here; the two attributes it comes apart into are the registry's to decide, not this file's.
 */
const EXPORT_THEME = getTheme('teal-light');

/** The tokens an exported page uses, and nothing else: an unused token is bytes in every file. */
export const EXPORT_TOKENS = [
  '--z-fg-default',
  '--z-fg-muted',
  '--z-fg-subtle',
  '--z-border',
  '--z-border-subtle',
  '--z-bg-code',
  '--z-bg-figure',
  '--z-bg-error-subtle',
  '--z-status-error',
  // The two the accent ramp reaches that the notebook itself spends on exactly these two things:
  // `--z-fg-serial-no` is the prompt down the left edge, which NotebookEditor.scss gives the accent
  // as ink because it is the one mark a reader looks for; `--z-bg-cell-output` is the tint under an
  // output area. Together with the borders they are what makes an exported page read as Zasper's
  // rather than as a generic white document.
  '--z-fg-serial-no',
  '--z-bg-cell-output',
] as const;

/** The sixteen palette slots `ansi_up` names with classes, which is what colours a traceback. */
export const ANSI_SLOTS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
] as const;

export type ExportPalette = Record<string, string>;

/**
 * Every chrome value the exported stylesheet needs, resolved as the light theme would resolve it.
 *
 * The probe is attached rather than detached because `getComputedStyle` on an element outside the
 * document resolves nothing. It is removed before this returns, and for the frame it exists it is
 * `aria-hidden` and fixed offscreen, so nothing reads it out and nothing scrolls to it.
 */
export function readExportPalette(): ExportPalette {
  const probe = document.createElement('div');
  probe.dataset.theme = EXPORT_THEME.theme;
  if (EXPORT_THEME.accent !== undefined) {
    probe.dataset.accent = EXPORT_THEME.accent;
  }
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;';
  document.body.appendChild(probe);

  try {
    const computed = getComputedStyle(probe);
    const palette: ExportPalette = {};

    const take = (name: string) => {
      const value = computed.getPropertyValue(name).trim();
      if (value !== '') {
        palette[name] = value;
      }
    };

    EXPORT_TOKENS.forEach(take);
    ANSI_SLOTS.forEach((slot) => take(`--z-ansi-${slot}`));

    return palette;
  } finally {
    probe.remove();
  }
}

/**
 * The palette as a `:root` block. Tokens the probe could not resolve are simply absent — jsdom
 * resolves no custom properties at all, so an export taken in a test is uncoloured rather than broken.
 */
export function paletteToCss(palette: ExportPalette): string {
  const lines = Object.entries(palette).map(([name, value]) => `  ${name}: ${value};`);
  return lines.length === 0 ? '' : `:root {\n${lines.join('\n')}\n}`;
}
