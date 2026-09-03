import { useMemo } from 'react';
import { useSetAtom } from 'jotai';

import { fontSizeAtom } from '@/store/AppState';
import { ICommand } from './types';

// Same bounds and step the font-size keydown handler in IDE.tsx used before this moved here.
const FONT_SIZE_STEP = 2;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;

/**
 * Commands that belong to the window rather than to any tab. Registered by `IDE.tsx`, so they are
 * available — and listed in the palette — even with nothing open.
 *
 * The palette's own two commands are not here: they act on state the Topbar owns, so the Topbar
 * registers them itself.
 */
export function useAppCommands(): ICommand[] {
  const setFontSize = useSetAtom(fontSizeAtom);

  return useMemo(
    () => [
      {
        id: 'view:increase-font-size',
        label: 'Increase Font Size',
        category: 'View',
        scope: 'app',
        // Two spellings because the shifted `=` key reports itself as `+`, and both are how
        // people press this.
        keys: ['Mod-=', 'Mod-+'],
        execute: () => setFontSize((size) => Math.min(size + FONT_SIZE_STEP, MAX_FONT_SIZE)),
      },
      {
        id: 'view:decrease-font-size',
        label: 'Decrease Font Size',
        category: 'View',
        scope: 'app',
        keys: ['Mod--'],
        execute: () => setFontSize((size) => Math.max(size - FONT_SIZE_STEP, MIN_FONT_SIZE)),
      },
    ],
    [setFontSize]
  );
}
