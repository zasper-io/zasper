/**
 * Chord parsing for `ICommand.keys`, in CodeMirror's notation so that one string serves both the
 * window dispatcher and a CodeMirror `keymap`.
 *
 * Hand-written rather than pulled from `w3c-keyname`: that package is present, but only as a
 * transitive dependency of `@codemirror/view`, and `@codemirror/view` does not re-export its
 * `keyName`. Everything needed here is on the event already.
 *
 * Every function takes the platform as a defaulted last argument. That is what makes the
 * `Mod-` translation testable on both platforms from one machine.
 */

/** Matches CodeMirror's own platform check, so `Mod-` means the same in both dispatchers. */
export const isMac = /Mac|iPhone|iPad|iPod/.test(
  typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent
);

export interface IParsedChord {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const PREFIXES: { prefix: string; apply: (chord: IParsedChord, mac: boolean) => void }[] = [
  {
    prefix: 'Mod-',
    apply: (chord, mac) => {
      if (mac) {
        chord.meta = true;
      } else {
        chord.ctrl = true;
      }
    },
  },
  { prefix: 'Cmd-', apply: (chord) => void (chord.meta = true) },
  { prefix: 'Meta-', apply: (chord) => void (chord.meta = true) },
  { prefix: 'Ctrl-', apply: (chord) => void (chord.ctrl = true) },
  { prefix: 'Control-', apply: (chord) => void (chord.ctrl = true) },
  { prefix: 'Alt-', apply: (chord) => void (chord.alt = true) },
  { prefix: 'Shift-', apply: (chord) => void (chord.shift = true) },
];

/**
 * `Mod-Shift-p` → `{meta, shift, key: 'p'}` on mac.
 *
 * Prefixes are stripped one at a time rather than split on `-`, so that `Mod--` (decrease font
 * size) parses as Mod plus the `-` key instead of as an empty key name.
 */
export function parseChord(binding: string, mac: boolean = isMac): IParsedChord {
  const chord: IParsedChord = { meta: false, ctrl: false, alt: false, shift: false, key: '' };
  let rest = binding;

  for (;;) {
    const match = PREFIXES.find(
      ({ prefix }) => rest.length > prefix.length && rest.startsWith(prefix)
    );
    if (!match) {
      break;
    }
    match.apply(chord, mac);
    rest = rest.slice(match.prefix.length);
  }

  chord.key = rest;
  return chord;
}

/**
 * Whether a keydown is the chord `binding` asks for.
 *
 * Shift is only compared for letters and named keys. For punctuation the shift state is already
 * baked into `event.key` — Shift+`=` arrives as `+` — so `Mod-=` and `Mod-+` are two separate
 * bindings and neither should also test the flag.
 */
export function chordMatches(binding: string, event: KeyboardEvent, mac: boolean = isMac): boolean {
  const chord = parseChord(binding, mac);

  if (chord.meta !== event.metaKey || chord.ctrl !== event.ctrlKey || chord.alt !== event.altKey) {
    return false;
  }
  if (shiftIsSignificant(chord.key) && chord.shift !== event.shiftKey) {
    return false;
  }
  return chord.key.toLowerCase() === event.key.toLowerCase();
}

function shiftIsSignificant(key: string): boolean {
  return key.length !== 1 || /[a-z]/i.test(key);
}

/** True for the modifier keys themselves, which are never a chord on their own. */
export function isModifierKey(key: string): boolean {
  return key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta';
}

/**
 * Named keys as mac writes them. Only on mac, and only the ones with a settled symbol — beside ⌃ and
 * ⇧ the word "Enter" reads as though the symbol were missing, but a made-up glyph reads as nothing.
 */
const MAC_KEY_SYMBOLS: Record<string, string> = {
  Enter: '⏎',
  Escape: '⎋',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** Renders a binding the way the platform writes it, for display in the palette. */
export function formatChord(binding: string, mac: boolean = isMac): string {
  const chord = parseChord(binding, mac);
  const parts: string[] = [];

  // Modifier order follows the platform's convention, not the order in the binding string.
  if (mac) {
    if (chord.ctrl) parts.push('⌃');
    if (chord.alt) parts.push('⌥');
    if (chord.shift) parts.push('⇧');
    if (chord.meta) parts.push('⌘');
  } else {
    if (chord.ctrl) parts.push('Ctrl');
    if (chord.meta) parts.push('Meta');
    if (chord.alt) parts.push('Alt');
    if (chord.shift) parts.push('Shift');
  }

  if (chord.key.length === 1) {
    parts.push(chord.key.toUpperCase());
  } else {
    parts.push((mac && MAC_KEY_SYMBOLS[chord.key]) || chord.key);
  }
  return mac ? parts.join('') : parts.join('+');
}
