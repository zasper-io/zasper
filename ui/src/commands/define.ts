import { Command } from './types';

/** What a command is, without what it does: enough for Help to list it and for a key to reach it. */
export type CommandInfo = Pick<
  Command,
  'id' | 'label' | 'category' | 'scope' | 'keys' | 'description'
>;

/**
 * Declares a module's commands as data, keyed by id, so they exist before any tab registers them.
 * The hook that registers a command spreads its entry and adds the behaviour: a label or a chord is
 * written once, and an id missing from the table does not compile.
 *
 * A command with keys belongs in a table listed in `catalog.ts`, or Help cannot show it.
 */
export function defineCommands<T extends Record<string, Omit<CommandInfo, 'id'>>>(
  table: T
): { [K in keyof T & string]: CommandInfo & { id: K } } {
  return Object.fromEntries(Object.entries(table).map(([id, info]) => [id, { ...info, id }])) as {
    [K in keyof T & string]: CommandInfo & { id: K };
  };
}
