import { useCallback, useEffect, useMemo, useRef } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import { ICommand } from './types';

/**
 * Every command currently available, keyed by id. An atom rather than a module-level map because
 * the palette lives in the Topbar, outside the tab tree, and has to re-render when the active tab
 * changes what is on offer — and because jotai is where all the other cross-cutting state in this
 * app lives (`fileTabsAtom`, `themeAtom`).
 *
 * "Currently available" is the point: a component registers its commands only while it is the
 * active tab, so a keybinding cannot reach a notebook that is open but hidden.
 */
export const commandsAtom = atom<Record<string, ICommand>>({});

/** Sorted for display, so the palette's order does not depend on mount order. */
export function useCommands(): ICommand[] {
  const commands = useAtomValue(commandsAtom);

  return useMemo(
    () =>
      Object.values(commands).sort(
        (a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label)
      ),
    [commands]
  );
}

/**
 * Runs a command by id, for toolbar buttons and the palette. Returns false when the id is not
 * registered or the command is disabled, so a caller can tell "did nothing" from "did something".
 */
export function useRunCommand(): (id: string) => boolean {
  const commands = useAtomValue(commandsAtom);

  return useCallback(
    (id: string) => {
      const command = commands[id];
      if (!command || (command.isEnabled && !command.isEnabled())) {
        return false;
      }
      command.execute();
      return true;
    },
    [commands]
  );
}

/**
 * Publishes `commands` into the registry while `active`, and withdraws them on unmount or when
 * `active` goes false.
 *
 * The subtlety is that command bodies close over per-render state — the cells, the kernel session
 * — so the array is a fresh set of closures on every keystroke. Writing that to the atom each time
 * would re-render every consumer continuously. Instead the array is kept in a ref and what gets
 * registered are stable proxies that read through the ref, so the atom is only written when the
 * set of *ids* changes. Labels and keys are therefore captured once; keep them static and put
 * anything that varies in `isEnabled`.
 */
export function useRegisterCommands(commands: ICommand[], active: boolean = true): void {
  const setCommands = useSetAtom(commandsAtom);
  const latest = useRef(commands);
  latest.current = commands;

  const ids = commands.map((command) => command.id).join('\n');

  useEffect(() => {
    if (!active || !ids) {
      return;
    }

    const proxies: Record<string, ICommand> = {};
    for (const registered of latest.current) {
      const id = registered.id;
      const find = () => latest.current.find((command) => command.id === id);
      proxies[id] = {
        ...registered,
        execute: () => find()?.execute(),
        isEnabled: () => {
          const command = find();
          return command ? (command.isEnabled?.() ?? true) : false;
        },
      };
    }

    setCommands((previous) => ({ ...previous, ...proxies }));

    return () => {
      setCommands((previous) => {
        const next = { ...previous };
        for (const id of Object.keys(proxies)) {
          // Only remove our own proxy: during a tab switch the incoming tab may already have
          // registered the same id, and it must not be torn down by the outgoing one.
          if (next[id] === proxies[id]) {
            delete next[id];
          }
        }
        return next;
      });
    };
  }, [ids, active, setCommands]);
}
