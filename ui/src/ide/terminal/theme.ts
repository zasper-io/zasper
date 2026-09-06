import type { ITheme } from '@xterm/xterm';

/**
 * The eight ANSI slots. Each one is also a `bright` variant, and the token name is the slot with
 * `--z-ansi-` in front of it and a hyphen where xterm capitalises: `--z-ansi-bright-black` is
 * `brightBlack`. Deriving both from one list is what keeps a typo from silently costing one colour —
 * xterm ignores a key it does not know, and the terminal goes on drawing that slot in its own default.
 */
const SLOTS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

/** Anything that answers `getPropertyValue`: a computed style, or a stub in a test. */
interface Values {
  getPropertyValue(name: string): string;
}

/**
 * The terminal's palette, out of the tokens on its own element.
 *
 * xterm draws to a canvas, so it takes strings at construction rather than reading CSS — the same
 * reason the mono family is read rather than restated. The sixteen it gets are the on-dark set in
 * every theme, which is not this function's decision: `.terminalContainer` in styles/_tokens.scss
 * scopes them, because the terminal is the one surface that is dark whatever the window is.
 *
 * A token that reads empty is left out rather than guessed at, so a slot falls back to xterm's own
 * value. That is a jsdom test with no stylesheet loaded, and it is also what a token deleted from
 * _tokens.scss should look like: one colour off, not a terminal painted in nothing.
 */
export function terminalTheme(values: Values): ITheme {
  const colours: Record<string, string> = {};
  const take = (key: string, token: string) => {
    const value = values.getPropertyValue(token).trim();
    if (value !== '') {
      colours[key] = value;
    }
  };

  for (const slot of SLOTS) {
    take(slot, `--z-ansi-${slot}`);
    take(`bright${slot[0].toUpperCase()}${slot.slice(1)}`, `--z-ansi-bright-${slot}`);
  }
  take('foreground', '--z-fg-on-terminal');
  // The block cursor, in the ink it sits among. `cursorAccent` — the character *under* it — is left to
  // xterm, which uses its own background rather than ours, and ours is transparent.
  take('cursor', '--z-fg-on-terminal');

  return {
    // The background stays in CSS: .terminalContainer paints --z-bg-terminal and the canvas is
    // transparent over it, so a theme change repaints the terminal instead of disposing it, and the
    // scrollback and the shell session survive. The sixteen above do not need that treatment because
    // they do not change with the theme.
    background: 'rgba(0, 0, 0, 0)',
    ...colours,
  };
}
