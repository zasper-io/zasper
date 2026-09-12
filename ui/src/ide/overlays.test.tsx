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
import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Tooltip from './Tooltip';
import { useDismissOnEscape, useDismissOnPressOutside, useTooltip } from './overlays';

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
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    settle(1);
    expect(screen.getByRole('tooltip')).toHaveTextContent('first line');
  });

  // The half a native `title` never had: a pointer that pauses is asking a question, a keyboard
  // arriving on the control has already asked it.
  it('gives a keyboard one at once, and describes the anchor with it', () => {
    render(<Labelled />);

    tabTo(anchor());

    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('second line');
    expect(anchor()).toHaveAttribute('aria-describedby', tip.id);
  });

  // Clicking a control focuses it too, and a box that opens on a click is in the way of whatever the
  // click just did. `:focus-visible` is what tells the two apart, and jsdom answers it.
  it('says nothing when a pointer put the focus there', () => {
    render(<Labelled />);

    fireEvent.focusIn(anchor());

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('goes on the way out, and describes nothing once it has', () => {
    render(<Labelled />);
    tabTo(anchor());

    fireEvent.blur(anchor());

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(anchor()).not.toHaveAttribute('aria-describedby');
  });

  // Nothing is dragged out of a tooltip, so a pointer leaving before the delay is up is a pointer that
  // was on its way somewhere else.
  it('never opens for a pointer that was passing through', () => {
    render(<Labelled />);

    fireEvent.pointerEnter(anchor());
    settle(200);
    fireEvent.pointerLeave(anchor());
    settle(400);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  // The family's rule, reaching the one member that is not a surface.
  it('closes on Escape', () => {
    render(<Labelled />);
    tabTo(anchor());

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  // It is placed against a box measured when it opened, so a panel scrolling under it leaves it
  // labelling whatever has moved into that spot.
  it('closes when what it points at moves', () => {
    render(<Labelled />);
    tabTo(anchor());

    fireEvent.scroll(window);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('stands down while inactive', () => {
    render(<Labelled active={false} />);

    tabTo(anchor());
    fireEvent.pointerEnter(anchor());
    settle(400);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
