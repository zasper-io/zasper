import { defineCommands } from '@/commands/define';

export const SEARCH_CHORD = 'Mod-k';

const view = { category: 'View', scope: 'app' } as const;

/** The ways into the palette. Registered by the Topbar, which is where the palette's state lives. */
export const PALETTE_COMMANDS = defineCommands({
  'palette:open': { ...view, label: 'Search Files and Commands', keys: [SEARCH_CHORD] },
  // Cmd is what every other editor uses on mac, but Ctrl is what this app was bound to before, so
  // both are accepted and nobody's habit breaks. Off mac they are the same chord, and displays dedupe it.
  'palette:open-commands': {
    ...view,
    label: 'Show All Commands',
    keys: ['Mod-Shift-p', 'Ctrl-Shift-p'],
  },
  'palette:open-files': { ...view, label: 'Go to File', keys: ['Mod-Shift-o', 'Ctrl-Shift-o'] },
});
