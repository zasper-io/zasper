import { RefObject, useEffect, useState } from 'react';

/**
 * The keys of a list that opens above the composer's field, for `@` and for `/`. The field keeps the
 * keyboard; Up and Down move through the list and Enter or Tab picks, taken from the field before it
 * sees them. Answers the index chosen, which goes back to the top when `reset` changes. Enter on an
 * entry `typed` says is already in the field in full is left to the field, which sends.
 */
export function usePickerKeys(
  field: RefObject<HTMLTextAreaElement | null>,
  count: number,
  onPick: (index: number) => void,
  reset: unknown,
  typed?: (index: number) => boolean
): number {
  const [chosen, setChosen] = useState(0);

  useEffect(() => setChosen(0), [reset]);

  useEffect(() => {
    const element = field.current;
    if (element === null) {
      return;
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (count === 0) {
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setChosen((current) => (current + step + count) % count);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        const index = Math.min(chosen, count - 1);
        if (event.key === 'Enter' && typed?.(index)) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        onPick(index);
      }
    };
    element.addEventListener('keydown', onKey, { capture: true });
    return () => element.removeEventListener('keydown', onKey, { capture: true });
  }, [field, count, chosen, onPick, typed]);

  return Math.min(chosen, Math.max(count - 1, 0));
}
