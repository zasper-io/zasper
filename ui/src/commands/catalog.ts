import { EDITOR_COMMANDS } from '@/ide/editor/editorCommands';
import { NOTEBOOK_COMMANDS } from '@/ide/editor/notebook/notebookCommands';
import { TAB_COMMANDS } from '@/ide/tabs/tabCommands';
import { PALETTE_COMMANDS } from '@/ide/topBar/paletteCommands';
import { APP_COMMANDS } from './appCommands';
import { CommandInfo } from './define';
import { HELP_COMMANDS } from './helpCommands';

const TABLES: Record<string, CommandInfo>[] = [
  APP_COMMANDS,
  PALETTE_COMMANDS,
  NOTEBOOK_COMMANDS,
  EDITOR_COMMANDS,
  HELP_COMMANDS,
  TAB_COMMANDS,
];

/**
 * Every command the app declares, whichever tab would register it. What the Help tab lists, so the
 * list is the same whatever has been open. Git's commands have no chords, so they have no table.
 */
export const ALL_COMMANDS: CommandInfo[] = TABLES.flatMap((table) => Object.values(table));
