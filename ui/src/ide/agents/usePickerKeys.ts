import { RefObject, useEffect, useState } from 'react';

/**
 * The keys of a list that opens above the composer's field, for `@` and for `/`. The field keeps the
 * keyboard; Up and Down move through the list and Enter or Tab picks, taken from the field before it
 * sees them. Answers the index chosen, which goes back to the top when `reset` changes.
 */
export function usePickerKeys(
  field: RefObject<HTMLTextAreaElement | null>,
  count: number,
  onPick: (index: number) => void,
  reset: unknown
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
        event.preventDefault();
        event.stopImmediatePropagation();
        onPick(Math.min(chosen, count - 1));
      }
    };
    element.addEventListener('keydown', onKey, { capture: true });
    return () => element.removeEventListener('keydown', onKey, { capture: true });
  }, [field, count, chosen, onPick]);

  return Math.min(chosen, Math.max(count - 1, 0));
}
