import { useMemo } from 'react';
import { useSetAtom } from 'jotai';

import { fontSizeAtom, zoomLevelAtom } from '@/store/AppState';
import { clampZoomLevel } from '@/zoom';
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
  const setZoomLevel = useSetAtom(zoomLevelAtom);

  return useMemo(
    () => [
      // Cmd +/-/0 zoom the window, as they do in VS Code and in the browser around it. They used to
      // resize the editor's font instead, which left every other length in the app where it was.
      {
        id: 'view:zoom-in',
        label: 'Zoom In',
        category: 'View',
        scope: 'app',
        // Two spellings because the shifted `=` key reports itself as `+`, and both are how
        // people press this.
        keys: ['Mod-=', 'Mod-+'],
        execute: () => setZoomLevel((level) => clampZoomLevel(level + 1)),
      },
      {
        id: 'view:zoom-out',
        label: 'Zoom Out',
        category: 'View',
        scope: 'app',
        keys: ['Mod--'],
        execute: () => setZoomLevel((level) => clampZoomLevel(level - 1)),
      },
      {
        id: 'view:zoom-reset',
        label: 'Reset Zoom',
        category: 'View',
        scope: 'app',
        keys: ['Mod-0'],
        execute: () => setZoomLevel(0),
      },
      // Palette-only, which is the whole difference between the two settings: this one is the size
      // of the code, the terminal and a cell's output, and the chrome around them does not move.
      {
        id: 'view:increase-font-size',
        label: 'Increase Font Size',
        category: 'View',
        scope: 'app',
        execute: () => setFontSize((size) => Math.min(size + FONT_SIZE_STEP, MAX_FONT_SIZE)),
      },
      {
        id: 'view:decrease-font-size',
        label: 'Decrease Font Size',
        category: 'View',
        scope: 'app',
        execute: () => setFontSize((size) => Math.max(size - FONT_SIZE_STEP, MIN_FONT_SIZE)),
      },
    ],
    [setFontSize, setZoomLevel]
  );
}
