import { useCallback, useRef, useState } from 'react';

/**
 * Whether an element scrolls, for the output box: a capped output is a region a keyboard has to be able
 * to scroll, and one that fits is not worth a Tab stop of its own.
 *
 * The box itself is watched, not its contents. It is capped, so it grows until it reaches the cap — which
 * is the moment it starts to scroll — and shrinks again when a shorter output replaces a long one.
 */
export function useOverflows<T extends HTMLElement>(): [(element: T | null) => void, boolean] {
  const [overflows, setOverflows] = useState(false);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (element === null) {
      return;
    }
    const check = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    check();
    if (typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(check);
      observer.current.observe(element);
    }
  }, []);

  return [ref, overflows];
}
