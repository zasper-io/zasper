import { useMemo } from 'react';
import { useSetAtom } from 'jotai';

import { zoomLevelAtom } from '@/zoom/atoms';
import { clampZoomLevel } from '@/zoom';
import { defineCommands } from './define';
import { Command } from './types';

const view = { category: 'View', scope: 'app' } as const;

/** The window's own commands. `view:toggle-sidebar` is registered by IDE.tsx, which owns the sidebar. */
export const APP_COMMANDS = defineCommands({
  // Cmd +/-/0 zoom the window, as they do in VS Code and in the browser around it: every length
  // scales, not just the editor's font.
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
  // No chord: ⌘, is the browser's own on mac, and this is a tab rather than a mode to flip.
  'view:settings': { ...view, label: 'Settings' },
  'view:search': { ...view, label: 'Search in Files', keys: ['Mod-Shift-f'] },
  'view:problems': { ...view, label: 'Problems', keys: ['Mod-Shift-m'] },
  // Ctrl on mac too, as in VS Code: ⌘` is the system's own window switch, and a shell has no use for
  // Ctrl-` that anyone relies on, so this one works with the terminal focused.
  'view:terminal': { ...view, label: 'Toggle Terminal', keys: ['Ctrl-`'] },
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
