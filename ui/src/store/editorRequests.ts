import { atom } from 'jotai';

/**
 * A line the reader asked for, from the palette's `:42`.
 *
 * A request rather than a call, because the palette lives in the topbar and the document lives in
 * CodeMirror: the file editor in front carries it out and clears it, and no editor behind it can.
 */
export const goToLineAtom = atom<number | null>(null);

/**
 * Bumped by the file editor on every update of the document or the cursor.
 *
 * A signal, not a value: the find card counts matches itself, because CodeMirror's search keeps no
 * count, and this is what tells it the answer may have changed. The editor writes it without reading
 * it, so nothing re-renders on a keystroke unless it is watching for exactly this.
 */
export const editorPulseAtom = atom(0);
