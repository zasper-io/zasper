/*
F6 and Shift-F6: the focus goes to the next or previous part of the window, as in VS Code and the
browser around it.

It is the one way out of a surface that keeps Tab for itself. A terminal sends Tab to the shell and
Escape to whatever runs in it, and a code editor indents with Tab, so from inside one of them the
keyboard otherwise had nowhere to go.

A region is any element marked `data-region`. They are visited in VS Code's order, skipping any that
are not on screen, and each gets back the element that last had the focus inside it, so F6 from the
terminal and back lands in the same cell rather than at the top of the notebook.
*/
import { useEffect } from 'react';

export const REGION_ORDER = ['editor', 'dock', 'agent', 'rail', 'sidebar'] as const;
export type Region = (typeof REGION_ORDER)[number];

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const lastFocused = new Map<string, HTMLElement>();

function regionElement(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-region="${name}"]`);
}

function isShown(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && element.closest('[hidden], .is-hidden') === null;
}

/** Where the focus goes on arriving in a region: where it was last, or its first control. */
function landingIn(region: HTMLElement): HTMLElement {
  const remembered = lastFocused.get(region.dataset.region ?? '');
  if (remembered?.isConnected && region.contains(remembered) && isShown(remembered)) {
    return remembered;
  }
  const first = [...region.querySelectorAll<HTMLElement>(TABBABLE)].find(isShown);
  if (first) {
    return first;
  }
  // A region with nothing to press still takes the focus, so a screen reader says where it is.
  region.tabIndex = -1;
  return region;
}

/** Moves the focus `step` regions on from the one that has it, wrapping round. */
export function focusRegion(step: 1 | -1): void {
  const shown = REGION_ORDER.map(regionElement).filter(
    (element): element is HTMLElement => element !== null && isShown(element)
  );
  if (shown.length === 0) {
    return;
  }
  const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
    '[data-region]'
  );
  const at = current ? shown.indexOf(current) : -1;
  // From outside every region, F6 goes to the first and Shift-F6 to the last.
  const next = at === -1 ? (step === 1 ? 0 : shown.length - 1) : at + step;
  landingIn(shown[(next + shown.length) % shown.length]).focus();
}

/** Remembers, per region, what last had the focus in it. Mounted once, in IDE.tsx. */
export function useRegionMemory(): void {
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      const region = target.closest<HTMLElement>('[data-region]')?.dataset.region;
      if (region) {
        lastFocused.set(region, target);
      }
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);
}
