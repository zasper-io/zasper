import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { focusRegion, useRegionMemory } from './regions';

function Memory() {
  useRegionMemory();
  return null;
}

/** The window's parts, in the DOM's order rather than F6's, so the order is the module's. */
function Window({ dock = true }: { dock?: boolean }) {
  return (
    <>
      <Memory />
      <nav data-region="rail">
        <button type="button">Files</button>
      </nav>
      <div data-region="sidebar">
        <button type="button">New file</button>
      </div>
      <div data-region="editor">
        <button type="button">First cell</button>
        <button type="button">Second cell</button>
      </div>
      <section data-region="dock" hidden={!dock}>
        <textarea aria-label="Terminal input" />
      </section>
      <aside data-region="agent" hidden>
        <button type="button">Send</button>
      </aside>
    </>
  );
}

// jsdom lays nothing out, so every element would count as off screen.
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 10,
    height: 10,
  } as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

describe('focusRegion', () => {
  it("goes round the window's parts in order, skipping what is not shown", () => {
    render(<Window />);
    screen.getByRole('textbox', { name: 'Terminal input' }).focus();

    focusRegion(1);
    expect(screen.getByRole('button', { name: 'Files' })).toHaveFocus();
    focusRegion(1);
    expect(screen.getByRole('button', { name: 'New file' })).toHaveFocus();
    focusRegion(1);
    expect(screen.getByRole('button', { name: 'First cell' })).toHaveFocus();
    focusRegion(1);
    expect(screen.getByRole('textbox', { name: 'Terminal input' })).toHaveFocus();
  });

  it('goes backwards on Shift-F6, and from outside every region to the last', () => {
    render(<Window dock={false} />);
    (document.activeElement as HTMLElement | null)?.blur();

    focusRegion(-1);
    expect(screen.getByRole('button', { name: 'New file' })).toHaveFocus();
    focusRegion(-1);
    expect(screen.getByRole('button', { name: 'Files' })).toHaveFocus();
    focusRegion(-1);
    expect(screen.getByRole('button', { name: 'First cell' })).toHaveFocus();
  });

  // xterm sizes its input from the font, so for a few frames after a terminal opens it is 0x0. Shift-F6
  // then landed on the dock's first tab rather than back in the shell.
  it('comes back to a remembered element even while it has no size', () => {
    render(<Window />);
    const shell = screen.getByRole('textbox', { name: 'Terminal input' });
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      return (this === shell ? { width: 0, height: 0 } : { width: 10, height: 10 }) as DOMRect;
    });
    shell.focus();

    focusRegion(1);
    focusRegion(-1);

    expect(shell).toHaveFocus();
  });

  it('comes back to what had the focus in a region, not to its first control', () => {
    render(<Window />);
    screen.getByRole('button', { name: 'Second cell' }).focus();

    focusRegion(1);
    expect(screen.getByRole('textbox', { name: 'Terminal input' })).toHaveFocus();
    focusRegion(-1);
    expect(screen.getByRole('button', { name: 'Second cell' })).toHaveFocus();
  });
});
