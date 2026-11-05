/*
The overlay family's dismissal rule, tested here rather than eight times over: **Escape closes the
topmost, and a press outside closes anything that is not a question.** The tooltip's own half — when one
is up, which is the only member of the family that opens itself — is at the bottom.

`useTooltip`'s delay is asserted against fake timers rather than waited out: 400ms of real time per case
is most of a test file's budget, and what is being checked is that the box does not arrive before it.

What is deliberately *not* asserted here is where the key was pressed, because that is the half these
hooks cannot see: they listen on the window, and something between the overlay and the window can stop
the event on its way up. It did — see FileBrowser.test.tsx, which presses Escape at the dialog.
*/
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Tooltip from './Tooltip';
import {
  useDismissOnEscape,
  useDismissOnPressOutside,
  useMenuKeys,
  useModalFocus,
  useTooltip,
} from './overlays';

function Escapable({ onDismiss, active }: { onDismiss: () => void; active?: boolean }) {
  useDismissOnEscape(onDismiss, active);
  return <div>overlay</div>;
}

function Outsideable({ onDismiss, active }: { onDismiss: () => void; active?: boolean }) {
  const surface = useRef<HTMLDivElement>(null);
  useDismissOnPressOutside(surface, onDismiss, active);
  return (
    <>
      <div ref={surface}>
        <button type="button">inside</button>
      </div>
      <button type="button">outside</button>
    </>
  );
}

describe('useDismissOnEscape', () => {
  it('dismisses on Escape and on nothing else', () => {
    const onDismiss = vi.fn();
    render(<Escapable onDismiss={onDismiss} />);

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // A row's tooltip and the menu opened from it: the tooltip's dismissal re-renders the row, which hands
  // the menu a new callback while the same Escape is still being dispatched. A browser renders between
  // two listeners of one event; flushSync is how a test does.
  it('is not lost when another overlay re-renders it during the same Escape', () => {
    const closed = vi.fn();
    function Row() {
      const [tooltip, setTooltip] = useState(true);
      return (
        <>
          {tooltip && <Escapable onDismiss={() => flushSync(() => setTooltip(false))} />}
          <Escapable onDismiss={() => closed()} />
        </>
      );
    }
    render(<Row />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(closed).toHaveBeenCalledTimes(1);
  });

  // A dialog mid-write, and the outer menu of two open overlays.
  it('stands down while inactive', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Escapable onDismiss={onDismiss} active={false} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(<Escapable onDismiss={onDismiss} active />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('lets go of the window when it unmounts', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Escapable onDismiss={onDismiss} />);

    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

function Menu({ onClose }: { onClose: () => void }) {
  const keys = useMenuKeys(onClose);
  return (
    <ul role="menu" {...keys}>
      <li role="none">
        <button type="button" role="menuitem" disabled>
          Paste
        </button>
      </li>
      {['Rename', 'Duplicate', 'Download', 'Delete'].map((label) => (
        <li key={label} role="none">
          <button type="button" role="menuitem">
            {label}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && <Menu onClose={() => setOpen(false)} />}
    </>
  );
}

describe('useMenuKeys', () => {
  const item = (name: string) => screen.getByRole('menuitem', { name });

  it('opens on the first item that can be picked, and goes round with the arrows', () => {
    render(<Menu onClose={vi.fn()} />);
    expect(item('Rename')).toHaveFocus();

    fireEvent.keyDown(item('Rename'), { key: 'ArrowDown' });
    expect(item('Duplicate')).toHaveFocus();
    fireEvent.keyDown(item('Duplicate'), { key: 'End' });
    expect(item('Delete')).toHaveFocus();
    fireEvent.keyDown(item('Delete'), { key: 'ArrowDown' });
    expect(item('Rename')).toHaveFocus();
    fireEvent.keyDown(item('Rename'), { key: 'ArrowUp' });
    expect(item('Delete')).toHaveFocus();
    fireEvent.keyDown(item('Delete'), { key: 'Home' });
    expect(item('Rename')).toHaveFocus();
  });

  it('goes to the next item starting with a typed letter', () => {
    render(<Menu onClose={vi.fn()} />);
    fireEvent.keyDown(item('Rename'), { key: 'd' });
    expect(item('Duplicate')).toHaveFocus();
    fireEvent.keyDown(item('Duplicate'), { key: 'd' });
    expect(item('Download')).toHaveFocus();
    fireEvent.keyDown(item('Download'), { key: 'd' });
    expect(item('Delete')).toHaveFocus();
  });

  it('closes on Tab, and gives the focus back to what opened it', async () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    expect(item('Rename')).toHaveFocus();

    fireEvent.keyDown(item('Rename'), { key: 'Tab' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

function Dialog({ autoFocusLast = false }: { autoFocusLast?: boolean }) {
  const modal = useModalFocus();
  return (
    <div role="dialog" aria-modal="true" aria-label="Delete" {...modal}>
      <button type="button">Close</button>
      <button type="button">Cancel</button>
      <button type="button" autoFocus={autoFocusLast}>
        Delete
      </button>
    </div>
  );
}

function DialogOpener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete notes.txt
      </button>
      {open && (
        <>
          <Dialog />
          <button type="button" onClick={() => setOpen(false)}>
            Answer
          </button>
        </>
      )}
    </>
  );
}

describe('useModalFocus', () => {
  const button = (name: string) => screen.getByRole('button', { name });

  it('takes the focus in, unless a control of its own already has', () => {
    const { unmount } = render(<Dialog />);
    expect(button('Close')).toHaveFocus();
    unmount();

    render(<Dialog autoFocusLast />);
    expect(button('Delete')).toHaveFocus();
  });

  it('keeps Tab and Shift-Tab inside', () => {
    render(<Dialog />);
    button('Delete').focus();
    fireEvent.keyDown(button('Delete'), { key: 'Tab' });
    expect(button('Close')).toHaveFocus();

    fireEvent.keyDown(button('Close'), { key: 'Tab', shiftKey: true });
    expect(button('Delete')).toHaveFocus();
  });

  it('gives the focus back to what opened it', async () => {
    render(<DialogOpener />);
    const opener = button('Delete notes.txt');
    opener.focus();
    fireEvent.click(opener);
    expect(button('Close')).toHaveFocus();

    fireEvent.click(button('Answer'));
    (document.activeElement as HTMLElement).blur();

    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe('useDismissOnPressOutside', () => {
  it('dismisses on a press outside the surface, and not on one inside it', () => {
    const onDismiss = vi.fn();
    render(<Outsideable onDismiss={onDismiss} />);

    fireEvent.mouseDown(screen.getByText('inside'));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByText('outside'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stands down while inactive', () => {
    const onDismiss = vi.fn();
    render(<Outsideable onDismiss={onDismiss} active={false} />);

    fireEvent.mouseDown(screen.getByText('outside'));

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

function Labelled({ active }: { active?: boolean }) {
  const tip = useTooltip(active);
  return (
    <>
      <button type="button" {...tip.anchorProps}>
        anchor
      </button>
      <Tooltip tip={tip} label={['first line', 'second line']} />
    </>
  );
}

describe('useTooltip', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const anchor = () => screen.getByText('anchor');
  const settle = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  /** The keyboard arriving, which is `:focus-visible` and so has to be a real focus. */
  const tabTo = (element: HTMLElement) => {
    element.focus();
    fireEvent.focusIn(element);
  };

  it('waits out the delay before a pointer gets one', () => {
    render(<Labelled />);

    fireEvent.pointerEnter(anchor());
    settle(399);
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();

    settle(1);
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('first line');
  });

  // The half a native `title` never had: a pointer that pauses is asking a question, a keyboard
  // arriving on the control has already asked it.
  it('gives a keyboard one at once, and describes the anchor with it', () => {
    render(<Labelled />);

    tabTo(anchor());

    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip).toHaveTextContent('second line');
    expect(anchor()).toHaveAttribute('aria-describedby', tip.id);
    // Hidden from the tree, so it is no part of a name, and still the anchor's description.
    expect(anchor()).toHaveAccessibleDescription(/second line/);
  });

  // Clicking a control focuses it too, and a box that opens on a click is in the way of whatever the
  // click just did. `:focus-visible` is what tells the two apart, and jsdom answers it.
  it('says nothing when a pointer put the focus there', () => {
    render(<Labelled />);

    fireEvent.focusIn(anchor());

    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
  });

  it('goes on the way out, and describes nothing once it has', () => {
    render(<Labelled />);
    tabTo(anchor());

    fireEvent.blur(anchor());

    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
    expect(anchor()).not.toHaveAttribute('aria-describedby');
  });

  // A press answers the question, and the pointer stays on what it pressed: the file tree's rows put a
  // box over the file that had just been opened, 400ms after opening it.
  it('says nothing more to a pointer that has pressed, until it leaves and comes back', () => {
    render(<Labelled />);

    fireEvent.pointerEnter(anchor());
    settle(200);
    fireEvent.pointerDown(anchor());
    settle(2000);
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();

    // Leaving is what makes it a new question.
    fireEvent.pointerLeave(anchor());
    fireEvent.pointerEnter(anchor());
    settle(400);
    expect(screen.getByRole('tooltip', { hidden: true })).toBeInTheDocument();
  });

  // The suppression above is the pointer's alone: a keyboard arriving on a control it just clicked is
  // still asking, and is the half that has no other way to the label.
  it('still describes a control the keyboard reaches after a press', () => {
    render(<Labelled />);

    fireEvent.pointerEnter(anchor());
    fireEvent.pointerDown(anchor());
    tabTo(anchor());

    expect(screen.getByRole('tooltip', { hidden: true })).toBeInTheDocument();
  });

  // Nothing is dragged out of a tooltip, so a pointer leaving before the delay is up is a pointer that
  // was on its way somewhere else.
  it('never opens for a pointer that was passing through', () => {
    render(<Labelled />);

    fireEvent.pointerEnter(anchor());
    settle(200);
    fireEvent.pointerLeave(anchor());
    settle(400);

    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
  });

  // The family's rule, reaching the one member that is not a surface.
  it('closes on Escape', () => {
    render(<Labelled />);
    tabTo(anchor());

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
  });

  // It is placed against a box measured when it opened, so a panel scrolling under it leaves it
  // labelling whatever has moved into that spot.
  it('closes when what it points at moves', () => {
    render(<Labelled />);
    tabTo(anchor());

    fireEvent.scroll(window);

    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
  });

  it('stands down while inactive', () => {
    render(<Labelled active={false} />);

    tabTo(anchor());
    fireEvent.pointerEnter(anchor());
    settle(400);

    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
  });
});
