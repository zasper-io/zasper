/*
The half of the overlay family that is not a stylesheet. styles/_overlays.scss says what a floating
surface looks like; this says when one is up and how it goes away:

  **Escape closes the topmost, and a press outside closes anything that is not a question.**

A dialog is a question, so it keeps its answer — Cancel or Escape, never a press on the backdrop. That
is why these are two hooks and not one `useDismiss`: eight dialogs want only the first, and the menus
and the palette want both.

Both listen on `window`, and have to. What is being dismissed is usually not what has the focus, and
five of these overlays are rendered *inside* the row that opened them, so a key pressed in one arrives
at that row's handlers too. Which is where the port found this family's only behaviour bug: the file
tree's own Escape stopped the event before the window ever saw it, so a delete confirmation could not
be dismissed by keyboard at all (see useTreeKeys, which now leaves a dialog's and a menu's keys alone).

Escape goes to the overlay that became active last, and only to it: a tooltip on a dialog's button
closes before the dialog does, and a second press closes the dialog. Before, one press closed both.
*/
import {
  FocusEventHandler,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEventHandler,
  RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

// Every active overlay's dismissal, oldest first. One window listener for all of them, so an overlay
// added or removed while a press is being handled cannot lose that press.
const escapeStack: { current: () => void }[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      escapeStack[escapeStack.length - 1]?.current();
    }
  });
}

/**
 * Escape, while `active`, if this is the overlay that became active last. A dialog passes `false` while
 * its write is in flight: the request has already gone, and taking the dialog away would only hide the
 * thing it is waiting for. An outer overlay that passes `false` steps out of the stack, so the one
 * under it gets the press.
 *
 * The callback is read through a ref, so a caller passing a new one every render keeps its place.
 */
export function useDismissOnEscape(onDismiss: () => void, active = true): void {
  const latest = useRef(onDismiss);
  useEffect(() => {
    latest.current = onDismiss;
  });

  useEffect(() => {
    if (!active) {
      return;
    }
    const entry = latest;
    escapeStack.push(entry);
    return () => {
      escapeStack.splice(escapeStack.lastIndexOf(entry), 1);
    };
  }, [active]);
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

const MENU_ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

function enabledItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(MENU_ITEM)].filter(
    (item) => !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true'
  );
}

/**
 * The keyboard half of a menu, for the element that carries `role="menu"`: spread what this returns on
 * it. Every menu in the app had the role and none of the keys, so a menu opened from the keyboard could
 * be seen and not used.
 *
 * Opening moves the focus to the first item the user can pick; Up and Down go round, Home and End go to
 * the ends, a letter goes to the next item starting with it, and Tab closes. Closing gives the focus
 * back to what had it before the menu opened — a frame later, and only if nothing else took it, so an
 * item that opens a rename box or a dialog keeps the focus it moved. Escape and a press outside stay
 * with `useDismissOnEscape` and `useDismissOnPressOutside`, which every menu already calls.
 *
 * A callback ref, because most of these menus are rendered only while open: it runs as the element
 * arrives and as it goes, which is exactly opening and closing. `focusFirst: false` is for a menu
 * that opens with a field of its own focused, such as the branch filter.
 */
export function useMenuKeys(onClose: () => void, { focusFirst = true } = {}) {
  const opener = useRef<HTMLElement | null>(null);
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });

  const ref = useCallback(
    (menu: HTMLElement | null) => {
      if (menu !== null) {
        opener.current = document.activeElement as HTMLElement | null;
        if (focusFirst) {
          enabledItems(menu)[0]?.focus();
        }
        return;
      }
      const back = opener.current;
      opener.current = null;
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && back?.isConnected) {
          back.focus();
        }
      });
    },
    [focusFirst]
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const items = enabledItems(event.currentTarget);
    if (items.length === 0) {
      return;
    }
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length].focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        return go(at + 1);
      case 'ArrowUp':
        return go(at === -1 ? items.length - 1 : at - 1);
      case 'Home':
        return go(0);
      case 'End':
        return go(items.length - 1);
      case 'Tab':
        event.preventDefault();
        latestClose.current();
        return;
    }
    if (event.key.length === 1 && event.key.trim() !== '' && !event.ctrlKey && !event.metaKey) {
      const letter = event.key.toLowerCase();
      const after = [...items.slice(at + 1), ...items.slice(0, at + 1)];
      const match = after.find((item) =>
        (item.textContent ?? '').trim().toLowerCase().startsWith(letter)
      );
      if (match) {
        event.preventDefault();
        match.focus();
      }
    }
  };

  return { ref, onKeyDown };
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What Tab stops at inside `root`: a button with `tabindex="-1"` matches the selector and is not one. */
function tabbable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => element.tabIndex >= 0
  );
}

// The last few things the focus was on outside every dialog: by the time a dialog's ref runs, its own
// autoFocus has already moved the focus in, so the opener has to have been noted before — from the
// start, since the first dialog is opened from something focused before any dialog existed. A few
// rather than one, because what opened a dialog can be gone by the time it closes: the palette's field,
// after a command run from it asks a question.
const outsideDialogs: HTMLElement[] = [];
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[aria-modal="true"]') === null) {
        const at = outsideDialogs.indexOf(target);
        if (at !== -1) {
          outsideDialogs.splice(at, 1);
        }
        outsideDialogs.push(target);
        if (outsideDialogs.length > 8) {
          outsideDialogs.shift();
        }
      }
    },
    true
  );
}

/**
 * The focus half of a modal dialog, for the element carrying `aria-modal`: spread what this returns
 * on it. The dialogs here are `div`s, so the browser did none of this and Tab walked out into the IDE
 * behind the backdrop.
 *
 * Opening puts the focus inside, on the first control, unless one of the dialog's own takes it with
 * autoFocus (ConfirmDialog's Cancel does); Tab and Shift-Tab go round inside; closing gives it back to
 * what had it before, or the last thing before that which is still there, unless something else has
 * taken the focus. Escape stays with
 * `useDismissOnEscape`, which every dialog calls with its own idea of when it may be dismissed.
 *
 * Not native `<dialog>`: `showModal()` would put the dialog in the top layer, above the toasts that are
 * meant to stay above it, and a dialog's Escape there is the browser's rather than the dialog's.
 */
export function useModalFocus() {
  const openers = useRef<HTMLElement[]>([]);

  const ref = useCallback((dialog: HTMLElement | null) => {
    if (dialog !== null) {
      openers.current = [...outsideDialogs];
      if (!dialog.contains(document.activeElement)) {
        const first = tabbable(dialog)[0];
        if (first !== undefined) {
          first.focus();
        } else {
          dialog.tabIndex = -1;
          dialog.focus();
        }
      }
      return;
    }
    const candidates = openers.current;
    openers.current = [];
    requestAnimationFrame(() => {
      const back = candidates.findLast((element) => element.isConnected);
      if (document.activeElement === document.body && back !== undefined) {
        back.focus();
      }
    });
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') {
      return;
    }
    const controls = tabbable(event.currentTarget);
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { ref, onKeyDown };
}

/**
 * How long a pointer has to rest on something before it is asking about it. A native `title` waits
 * about a second, which is long enough that most people never find out the label is there; 400ms is
 * short enough to feel like an answer and long enough that dragging the pointer down a list of kernels
 * does not flash a box at every row on the way past.
 */
export const TOOLTIP_DELAY_MS = 400;

/**
 * Whether the keyboard put the focus here. Every browser the app runs in answers `:focus-visible`; one
 * that does not throws on the selector, and there the old behaviour — a tooltip on any focus — is the
 * better of the two failures.
 */
function isKeyboardFocus(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** The pointer half: the box the pointer has to rest on. */
interface TooltipHoverProps {
  onPointerEnter: PointerEventHandler<HTMLElement>;
  onPointerLeave: PointerEventHandler<HTMLElement>;
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
}

/** What an anchor can ask for beyond the defaults. The file tree is the only caller that does. */
export interface TooltipOptions {
  /** Instead of `TOOLTIP_DELAY_MS`. */
  delayMs?: number;
  /**
   * Count the delay from when the pointer stopped rather than from when it arrived: any movement
   * inside the anchor starts it again.
   *
   * For a row in a list, which is what this exists for, the two are different questions. A pointer
   * crossing the file tree on its way to a file is not asking about the rows it passes, however
   * slowly it passes them, and an elapsed-time delay cannot tell that from someone resting on one.
   */
  stillness?: boolean;
}

/** The keyboard half, and the description: the box that takes the focus. */
interface TooltipFocusProps {
  onFocus: FocusEventHandler<HTMLElement>;
  onBlur: FocusEventHandler<HTMLElement>;
  'aria-describedby'?: string;
}

/** What `useTooltip` gives the anchor: the four handlers, and the description while there is one. */
interface TooltipAnchorProps extends TooltipHoverProps, TooltipFocusProps {}

export interface TooltipState {
  /** Spread onto whatever the tooltip labels, when one element both takes the focus and is labelled. */
  anchorProps: TooltipAnchorProps;
  /**
   * The same handlers in two halves, for a box that is not the one that takes the focus: a tree row is
   * a link inside the `li` that is focusable, and that `li` also holds the folder's children.
   */
  hoverProps: TooltipHoverProps;
  focusProps: TooltipFocusProps;
  /** The tooltip's own id, which `aria-describedby` above points at while it is showing. */
  id: string;
  /**
   * The anchor's box in window pixels while the tooltip is showing, and null while it is not — which is
   * both the flag saying whether to draw one and everything needed to place it. A box rather than the
   * element, because it is read once when the tooltip opens: nothing under a tooltip moves while it is
   * up, and anything that does takes it away (below).
   */
  anchor: DOMRect | null;
}

/**
 * The other half of a tooltip: hover, focus, a delay and a dismissal. One hook per anchor — it holds one
 * box, so a list gives each row its own — and `ide/Tooltip.tsx` draws what it decides to show.
 *
 * Focus shows it with no delay, and that asymmetry is the point of the whole thing: a pointer that
 * pauses is asking a question, while a keyboard arriving on a control has already asked it. It is also
 * the half a native `title` never had, which is why 66 of them are invisible to anyone not using a mouse.
 *
 * Keyboard focus, which is `:focus-visible` and not `:focus`: clicking a control focuses it as well,
 * and a box that opens on a click is in the way of whatever the click just did — a renamed row, an
 * opened file. The browser already decides which kind of focus this was, so this asks it rather than
 * tracking the last input itself.
 *
 * Anything that moves the anchor takes the tooltip away rather than chasing it — a scroll, a resize, and
 * Escape, which is the family's rule and reaches this through the same hook every other overlay uses.
 * The scroll listener captures, because what scrolls is a panel and not the window.
 *
 * `labelled` is for the case where the element the handler fired on is bigger than the thing being
 * described: a folder's `li` is the whole expanded subtree, so it is the row inside it that gets
 * measured. Left out, the box is whatever the event arrived on.
 */
export function useTooltip(
  active = true,
  labelled?: RefObject<HTMLElement | null>,
  options: TooltipOptions = {}
): TooltipState {
  const { delayMs = TOOLTIP_DELAY_MS, stillness = false } = options;
  const id = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // Set by a press and cleared when the pointer leaves: see `onPointerDown` below.
  const pressed = useRef(false);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setAnchor(null);
  }, []);

  const show = useCallback(
    (element: HTMLElement, delay: number) => {
      window.clearTimeout(timer.current);
      if (!active) {
        return;
      }
      const measure = () => setAnchor((labelled?.current ?? element).getBoundingClientRect());
      // Measured when it opens rather than when the pointer arrived, so a row that moved during the
      // delay is labelled where it is now. Focus takes no delay at all — not even a zero timer, which
      // would still cost a frame with the control already focused.
      if (delay === 0) {
        measure();
        return;
      }
      timer.current = window.setTimeout(measure, delay);
    },
    [active, labelled]
  );

  // A control that is disabled or unmounted mid-delay leaves a timer behind, and a tooltip that opens
  // after its anchor has gone points at nothing.
  useEffect(() => {
    if (!active) {
      hide();
    }
    return () => window.clearTimeout(timer.current);
  }, [active, hide]);

  useDismissOnEscape(hide, anchor !== null);

  useEffect(() => {
    if (anchor === null) {
      return;
    }
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchor, hide]);

  const hoverProps: TooltipHoverProps = {
    onPointerEnter: (event) => {
      if (!pressed.current) {
        show(event.currentTarget, delayMs);
      }
    },
    // Only with `stillness`, and only until the box is up: a pointer moving inside the anchor is
    // still on its way somewhere, so the wait starts again. Once the box is open, movement inside
    // the anchor leaves it alone — it is answering a question that has already been asked.
    onPointerMove: (event) => {
      if (stillness && !pressed.current && anchor === null) {
        show(event.currentTarget, delayMs);
      }
    },
    onPointerLeave: () => {
      pressed.current = false;
      hide();
    },
    // A press answers the question the tooltip would have asked, and the pointer is still sitting on
    // the row afterwards — so without this the box opened over the file that had just been opened, or
    // over the button that had just been pressed, and stayed until the pointer moved. It is the same
    // rule `:focus-visible` already applies to the keyboard half; nothing is owed to a pointer that has
    // acted. The keyboard is unaffected: only the hover path consults this, so tabbing back to a
    // control still describes it.
    onPointerDown: () => {
      pressed.current = true;
      hide();
    },
  };
  const focusProps: TooltipFocusProps = {
    onFocus: (event) => {
      if (isKeyboardFocus(event.currentTarget)) {
        show(event.currentTarget, 0);
      }
    },
    onBlur: hide,
    'aria-describedby': anchor === null ? undefined : id,
  };

  return { id, anchor, hoverProps, focusProps, anchorProps: { ...hoverProps, ...focusProps } };
}
