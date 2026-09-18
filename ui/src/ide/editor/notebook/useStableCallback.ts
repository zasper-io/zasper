import { useCallback, useRef } from 'react';

/**
 * A function whose identity never changes and that always calls the latest `fn`. For the actions the
 * notebook hands every cell: their bodies close over the current document, but a new identity on each
 * keystroke would be a new context value, and every cell would render again.
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result
): (...args: Args) => Result {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: Args) => latest.current(...args), []);
}
