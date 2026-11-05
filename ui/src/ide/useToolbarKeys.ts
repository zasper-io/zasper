import { FocusEvent, KeyboardEvent, useEffect, useRef } from 'react';

const ITEM = 'button:not([disabled]), select:not([disabled])';

function itemsOf(bar: HTMLElement): HTMLElement[] {
  return [...bar.querySelectorAll<HTMLElement>(ITEM)];
}

/**
 * The keyboard half of a `role="toolbar"`: spread what this returns on it. The toolbar is one Tab stop,
 * the control last used in it, and Left/Right, Home and End move along it. Left and Right are taken
 * from a select as well, where Chrome would change the value: Up and Down still do that.
 *
 * Which control is the stop is set on the elements rather than through their props, so a toolbar's
 * controls need not know they are in one; it is checked after every render, since a control can come
 * and go with the state it shows.
 */
export function useToolbarKeys() {
  const ref = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement | null>(null);

  const sync = () => {
    const bar = ref.current;
    if (bar === null) {
      return;
    }
    const items = itemsOf(bar);
    if (current.current === null || !items.includes(current.current)) {
      current.current = items[0] ?? null;
    }
    for (const item of items) {
      item.tabIndex = item === current.current ? 0 : -1;
    }
  };

  useEffect(sync);

  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (itemsOf(event.currentTarget).includes(event.target)) {
      current.current = event.target;
      sync();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const items = itemsOf(event.currentTarget);
    const at = items.indexOf(event.target as HTMLElement);
    if (at === -1) {
      return;
    }
    const go = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length].focus();
    };
    switch (event.key) {
      case 'ArrowRight':
        return go(at + 1);
      case 'ArrowLeft':
        return go(at - 1);
      case 'Home':
        return go(0);
      case 'End':
        return go(items.length - 1);
    }
  };

  return { ref, role: 'toolbar', onFocus, onKeyDown };
}
