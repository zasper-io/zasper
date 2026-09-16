import { afterEach, describe, expect, it, vi } from 'vitest';

import { paletteToCss, readExportPalette } from './exportTheme';

/**
 * The probe the palette is read from, caught on its way into the document.
 *
 * Its attributes are the whole test: jsdom loads no stylesheet, so the custom properties themselves
 * resolve to nothing and there are no values to assert on. What can be asserted is which theme was
 * asked — and that is the decision, since `_accents.scss` keys the entire ramp off these two.
 */
function probeAttributes(): { theme?: string; accent?: string } {
  const appended: HTMLElement[] = [];
  const spy = vi.spyOn(document.body, 'appendChild').mockImplementation(((node: Node) => {
    appended.push(node as HTMLElement);
    return node;
  }) as typeof document.body.appendChild);

  readExportPalette();
  spy.mockRestore();

  const probe = appended[0];
  return { theme: probe?.dataset.theme, accent: probe?.dataset.accent };
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.accent;
});

describe('readExportPalette', () => {
  it('reads the teal light theme', () => {
    expect(probeAttributes()).toEqual({ theme: 'light', accent: 'teal' });
  });

  // The decision this file exists for: two people exporting the same notebook hand over the same
  // looking file, whatever each of them has the editor set to.
  it('ignores the theme the editor is in', () => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.accent = 'orange';

    expect(probeAttributes()).toEqual({ theme: 'light', accent: 'teal' });
  });

  it('leaves nothing behind in the document', () => {
    readExportPalette();

    expect(document.querySelector('[data-accent="teal"]')).toBeNull();
  });
});

describe('paletteToCss', () => {
  it('writes the values it was given as a :root block', () => {
    expect(paletteToCss({ '--z-border': '#cfe9e7' })).toBe(':root {\n  --z-border: #cfe9e7;\n}');
  });

  // jsdom resolves no custom properties at all, so an export taken in a test is uncoloured rather
  // than broken — every rule in the sheet carries a fallback for exactly this.
  it('writes nothing for a palette that resolved nothing', () => {
    expect(paletteToCss({})).toBe('');
  });
});
