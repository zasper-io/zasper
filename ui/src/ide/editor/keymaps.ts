import { Extension, Prec } from '@codemirror/state';

/** What Settings → Editor → Keymap can be. */
export type KeymapName = 'default' | 'vim' | 'emacs';

/**
 * The chosen keymap, loaded on demand, or null for CodeMirror's own bindings.
 *
 * Loaded rather than bundled because almost nobody chooses one and each is tens of kilobytes, and at
 * `Prec.highest` because a keymap that loses to the default one is not a keymap: vim's `x` would insert
 * an `x`. The editor draws with its own bindings until the module arrives, which is a keystroke or two
 * on a first open and nothing afterwards.
 */
export function lazyKeymap(name: KeymapName): Promise<Extension> | null {
  if (name === 'vim') {
    return import('@replit/codemirror-vim').then(({ vim }) => Prec.highest(vim()));
  }
  if (name === 'emacs') {
    return import('@replit/codemirror-emacs').then(({ emacs }) => Prec.highest(emacs()));
  }
  return null;
}
