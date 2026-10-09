/** How far down the pane a cell Shift-Enter steps to lands, so the output of the one run has room above it. */
const LANDING = 0.35;
/** The part of that cell kept in view while the output grows: its first line of code. */
const PEEK = 48;
/** Anything the user does to the pane, which ends a follow. */
const USER_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

export interface ScrollKeeper {
  observe: (box: HTMLElement) => void;
  unobserve: (box: HTMLElement) => void;
  /** Takes the anchor afresh, after the focus moves or the notebook is scrolled on purpose. */
  record: () => void;
  /** Shift-Enter's step from the cell just run to `next`. */
  advance: (ran: HTMLElement | undefined, next: HTMLElement) => void;
  dispose: () => void;
}

/**
 * What keeps the notebook still while cells change height. The anchor is the focused cell while it is
 * in view, and otherwise the first cell that is: a cell above it growing scrolls the pane by as much,
 * so the anchor stays where it was on screen. The browser's own scroll anchoring is off on
 * `.notebook-body`, because it anchors near the top of the pane rather than on the focused cell.
 *
 * The one exception is the output of the cell Shift-Enter just ran, which is the reason it was run:
 * until the user next scrolls, clicks or presses a key, it may push the next cell down but never pull it
 * up, and the pane scrolls only to keep that cell's first line in view, never past the start of the
 * output.
 */
export function createScrollKeeper(focusedBox: () => HTMLElement | undefined): ScrollKeeper {
  if (typeof ResizeObserver === 'undefined') {
    const noop = () => {};
    return { observe: noop, unobserve: noop, record: noop, advance: noop, dispose: noop };
  }

  const boxes = new Set<HTMLElement>();
  let scroller: HTMLElement | null = null;
  let anchor: { box: HTMLElement; offset: number } | null = null;
  let following: { ran: HTMLElement; next: HTMLElement; nextOffset: number } | null = null;

  const view = () => scroller!.getBoundingClientRect();
  const topOf = (box: HTMLElement) => box.getBoundingClientRect().top - view().top;
  const inView = (box: HTMLElement) => {
    const at = box.getBoundingClientRect();
    const pane = view();
    return at.bottom > pane.top && at.top < pane.bottom;
  };

  const record = () => {
    if (scroller === null) {
      return;
    }
    let box = following?.ran;
    if (box === undefined) {
      const focused = focusedBox();
      box = focused && inView(focused) ? focused : firstInView();
    }
    anchor = box === undefined ? null : { box, offset: topOf(box) };
    if (following !== null) {
      following.nextOffset = topOf(following.next);
    }
  };

  const firstInView = () => {
    const top = view().top;
    let first: HTMLElement | undefined;
    let firstTop = Infinity;
    for (const box of boxes) {
      const at = box.getBoundingClientRect();
      if (at.bottom > top && at.top < firstTop) {
        first = box;
        firstTop = at.top;
      }
    }
    return first;
  };

  const keepNextInView = ({ ran, next, nextOffset }: NonNullable<typeof following>) => {
    // Re-running a cell clears its old output first, and the next cell must not ride up with it.
    const rose = nextOffset - topOf(next);
    if (rose > 0) {
      scroller!.scrollTop -= rose;
    }
    const pane = view();
    const hidden = next.getBoundingClientRect().top + PEEK - pane.bottom;
    const output = (ran.querySelector('.inner-text') ?? ran).getBoundingClientRect().top - pane.top;
    const by = Math.min(hidden, output);
    if (by > 0) {
      scroller!.scrollTop += by;
    }
  };

  const settle = () => {
    if (scroller === null) {
      return;
    }
    if (anchor?.box.isConnected) {
      const moved = topOf(anchor.box) - anchor.offset;
      if (moved !== 0) {
        scroller.scrollTop += moved;
      }
    }
    if (following?.ran.isConnected && following.next.isConnected) {
      keepNextInView(following);
    }
    record();
  };

  const observer = new ResizeObserver(settle);

  const stopFollowing = () => {
    following = null;
    record();
  };

  const attach = (pane: HTMLElement) => {
    scroller = pane;
    pane.addEventListener('scroll', record, { passive: true });
    USER_INPUT.forEach((type) => pane.addEventListener(type, stopFollowing, { passive: true }));
  };

  return {
    observe: (box) => {
      boxes.add(box);
      if (scroller === null) {
        const pane = box.closest<HTMLElement>('.notebook-body');
        if (pane !== null) {
          attach(pane);
        }
      }
      observer.observe(box);
    },
    unobserve: (box) => {
      boxes.delete(box);
      observer.unobserve(box);
      // A cell removed above the anchor moves it without anything resizing.
      requestAnimationFrame(settle);
    },
    record,
    advance: (ran, next) => {
      following = null;
      if (scroller === null) {
        return;
      }
      const pane = view();
      const at = next.getBoundingClientRect();
      if (at.top < pane.top || at.bottom > pane.bottom) {
        scroller.scrollTop += at.top - pane.top - pane.height * LANDING;
      }
      following = ran === undefined ? null : { ran, next, nextOffset: 0 };
      record();
    },
    dispose: () => {
      observer.disconnect();
      if (scroller !== null) {
        scroller.removeEventListener('scroll', record);
        USER_INPUT.forEach((type) => scroller!.removeEventListener(type, stopFollowing));
      }
    },
  };
}
