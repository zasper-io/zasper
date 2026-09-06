/*
The half of the overlay family that is not a stylesheet. styles/_overlays.scss says what a floating
surface looks like; this says how one goes away:

  **Escape closes the topmost, and a press outside closes anything that is not a question.**

A dialog is a question, so it keeps its answer — Cancel or Escape, never a press on the backdrop. That
is why these are two hooks and not one `useDismiss`: eight dialogs want only the first, and the menus
and the palette want both.

Both listen on `window`, and have to. What is being dismissed is usually not what has the focus, and
five of these overlays are rendered *inside* the row that opened them, so a key pressed in one arrives
at that row's handlers too. Which is where the port found this family's only behaviour bug: the file
tree's own Escape stopped the event before the window ever saw it, so a delete confirmation could not
be dismissed by keyboard at all (see useTreeKeys, which now leaves a dialog's and a menu's keys alone).

There is no registry deciding which overlay is topmost. With eight dialogs and three menus the cases
where two are open at once are countable, and the outer one steps back by passing `active: false` —
BranchMenu does exactly that while its delete dialog is up.
*/
import { RefObject, useEffect } from 'react';

/**
 * Escape, while `active`. A dialog passes `false` while its write is in flight: the request has already
 * gone, and taking the dialog away would only hide the thing it is waiting for.
 */
export function useDismissOnEscape(onDismiss: () => void, active = true): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [active, onDismiss]);
}

/**
 * A press anywhere outside `within`, while `active`.
 *
 * `mousedown` rather than `click`, so the overlay is gone before whatever is underneath takes the
 * focus — a click into a notebook cell should land in the cell. It is also what closes one context menu
 * when a second row is right-clicked: mousedown arrives before contextmenu, so the open menu goes
 * before the new one arrives.
 */
export function useDismissOnPressOutside(
  within: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active = true
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const dismiss = (event: MouseEvent) => {
      if (within.current !== null && !within.current.contains(event.target as Node)) {
        onDismiss();
      }
    };
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [active, onDismiss, within]);
}
