import { useMemo } from 'react';
import { useSetAtom } from 'jotai';

import { zoomLevelAtom } from '@/store/AppState';
import { clampZoomLevel } from '@/zoom';
import { ICommand } from './types';

/**
 * Commands that belong to the window rather than to any tab. Registered by `IDE.tsx`, so they are
 * available — and listed in the palette — even with nothing open.
 *
 * The palette's own two commands are not here: they act on state the Topbar owns, so the Topbar
 * registers them itself.
 */
export function useAppCommands(): ICommand[] {
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
    ],
    [setZoomLevel]
  );
}
