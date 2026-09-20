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

There is no registry deciding which overlay is topmost. With eight dialogs and three menus the cases
where two are open at once are countable, and the outer one steps back by passing `active: false` —
BranchMenu does exactly that while its delete dialog is up.
*/
import {
  FocusEventHandler,
  PointerEventHandler,
  RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

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
      // delay is not labelled where it used to be. Focus asks for no delay at all and gets none —
      // not a zero timer, which would still cost a frame with the control already focused.
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
