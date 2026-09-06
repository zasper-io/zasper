/*
The palette xterm is handed, which is the one part of the terminal a browser test cannot read back
cheaply: the sixteen colours end up inside a canvas renderer, so a wrong *key* — `bright-black` where
xterm wants `brightBlack` — looks like nothing at all until somebody runs a program that uses that slot.
e2e/tests/terminal.spec.ts checks that the palette arrives at all; this checks that all sixteen do.
*/
import { describe, expect, it } from 'vitest';

import { terminalTheme } from './theme';

/** A computed style, as far as this function is concerned. */
function values(declared: Record<string, string>) {
  return { getPropertyValue: (name: string) => declared[name] ?? '' };
}

const sixteen = Object.fromEntries(
  ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].flatMap((slot, index) => [
    [`--z-ansi-${slot}`, `#00000${index}`],
    [`--z-ansi-bright-${slot}`, `#10000${index}`],
  ])
);

describe('the terminal palette', () => {
  it('names all sixteen slots the way xterm does', () => {
    const theme = terminalTheme(values(sixteen));

    expect(theme.black).toBe('#000000');
    expect(theme.brightBlack).toBe('#100000');
    expect(theme.white).toBe('#000007');
    expect(theme.brightWhite).toBe('#100007');
    // Sixteen colours, plus the transparent background below.
    expect(Object.keys(theme)).toHaveLength(17);
  });

  it('keeps the background transparent, so the theme is CSS and the session survives one', () => {
    expect(terminalTheme(values({})).background).toBe('rgba(0, 0, 0, 0)');
  });

  it('takes the foreground and the cursor from the surface, not from xterm', () => {
    const theme = terminalTheme(values({ '--z-fg-on-terminal': '#ffffff' }));

    expect(theme.foreground).toBe('#ffffff');
    expect(theme.cursor).toBe('#ffffff');
  });

  it('leaves out what no stylesheet answers, rather than passing an empty colour', () => {
    // getPropertyValue answers '' for a token that is not declared, and xterm reads '' as a colour it
    // cannot parse. A jsdom test loads no stylesheet, so this is every one of them.
    expect(terminalTheme(values({}))).toEqual({ background: 'rgba(0, 0, 0, 0)' });
  });

  it('trims, because a declaration in a stylesheet is written with a space after the colon', () => {
    expect(terminalTheme(values({ '--z-ansi-red': ' #cd3131 ' })).red).toBe('#cd3131');
  });
});
