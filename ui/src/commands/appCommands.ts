import { useMemo } from 'react';
import { useSetAtom } from 'jotai';

import { zoomLevelAtom } from '@/zoom/atoms';
import { clampZoomLevel } from '@/zoom';
import { defineCommands } from './define';
import { Command } from './types';

const view = { category: 'View', scope: 'app' } as const;

/** The window's own commands. `view:toggle-sidebar` is registered by IDE.tsx, which owns the sidebar. */
export const APP_COMMANDS = defineCommands({
  // Cmd +/-/0 zoom the window, as they do in VS Code and in the browser around it. They used to
  // resize the editor's font instead, which left every other length in the app where it was.
  'view:zoom-in': {
    ...view,
    label: 'Zoom In',
    // Two spellings because the shifted `=` key reports itself as `+`, and both are how
    // people press this.
    keys: ['Mod-=', 'Mod-+'],
  },
  'view:zoom-out': { ...view, label: 'Zoom Out', keys: ['Mod--'] },
  'view:zoom-reset': { ...view, label: 'Reset Zoom', keys: ['Mod-0'] },
  'view:toggle-sidebar': { ...view, label: 'Toggle Sidebar', keys: ['Mod-b'] },
});

/**
 * Commands that belong to the window rather than to any tab. Registered by `IDE.tsx`, so they are
 * available — and listed in the palette — even with nothing open.
 *
 * The palette's own two commands are not here: they act on state the Topbar owns, so the Topbar
 * registers them itself.
 */
export function useAppCommands(): Command[] {
  const setZoomLevel = useSetAtom(zoomLevelAtom);

  return useMemo(
    () => [
      {
        ...APP_COMMANDS['view:zoom-in'],
        execute: () => setZoomLevel((level) => clampZoomLevel(level + 1)),
      },
      {
        ...APP_COMMANDS['view:zoom-out'],
        execute: () => setZoomLevel((level) => clampZoomLevel(level - 1)),
      },
      { ...APP_COMMANDS['view:zoom-reset'], execute: () => setZoomLevel(0) },
    ],
    [setZoomLevel]
  );
}
