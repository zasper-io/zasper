/*
The overlay family's dismissal rule, tested here rather than eight times over: **Escape closes the
topmost, and a press outside closes anything that is not a question.**

What is deliberately *not* asserted here is where the key was pressed, because that is the half these
hooks cannot see: they listen on the window, and something between the overlay and the window can stop
the event on its way up. It did — see FileBrowser.test.tsx, which presses Escape at the dialog.
*/
import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDismissOnEscape, useDismissOnPressOutside } from './overlays';

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
