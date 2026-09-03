import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';

import { commandsAtom, useCommands, useRegisterCommands, useRunCommand } from './registry';
import { ICommand } from './types';

// A fresh jotai store per test: the registry is global by design, so without this the commands
// one test registers would still be there in the next.
const wrapper = ({ children }: { children: React.ReactNode }) => <Provider>{children}</Provider>;

function command(overrides: Partial<ICommand> = {}): ICommand {
  return {
    id: 'test:one',
    label: 'One',
    category: 'Test',
    scope: 'app',
    execute: () => {},
    ...overrides,
  };
}

/** Registers whatever it is given and exposes the registry back, as a component would. */
function useHarness(commands: ICommand[], active = true) {
  useRegisterCommands(commands, active);
  return {
    registry: useAtomValue(commandsAtom),
    commands: useCommands(),
    run: useRunCommand(),
  };
}

describe('useRegisterCommands', () => {
  it('publishes commands so they can be run by id', () => {
    const execute = vi.fn();
    const { result } = renderHook(() => useHarness([command({ execute })]), { wrapper });

    let ran = false;
    act(() => {
      ran = result.current.run('test:one');
    });

    expect(ran).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('registers nothing while inactive — this is what keeps a hidden tab from responding', () => {
    const execute = vi.fn();
    const { result } = renderHook(() => useHarness([command({ execute })], false), { wrapper });

    expect(result.current.commands).toEqual([]);
    act(() => {
      expect(result.current.run('test:one')).toBe(false);
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('withdraws them again when the owner unmounts', () => {
    const seen: string[][] = [];

    const Observer = () => {
      seen.push(useCommands().map((c) => c.id));
      return null;
    };
    const Registrant = () => {
      useRegisterCommands([command()]);
      return null;
    };

    const { rerender } = render(
      <Provider>
        <Observer />
        <Registrant />
      </Provider>
    );
    expect(seen[seen.length - 1]).toEqual(['test:one']);

    // The observer stays mounted, so it sees what the registry looks like once the owner is gone.
    rerender(
      <Provider>
        <Observer />
      </Provider>
    );
    expect(seen[seen.length - 1]).toEqual([]);
  });

  // Command bodies close over per-render state, so callers rebuild the array on every render —
  // every keystroke in a notebook. Writing that to the atom each time would re-render the palette,
  // the toolbar and the dispatcher continuously.
  it('does not touch the registry when the array is rebuilt with the same ids', () => {
    let renders = 0;
    const { result, rerender } = renderHook(
      () => {
        renders += 1;
        return useHarness([command({ execute: () => {} })]);
      },
      { wrapper }
    );

    const registryAfterFirstRegistration = result.current.registry;
    rerender();
    rerender();

    expect(renders).toBeGreaterThan(2);
    expect(result.current.registry).toBe(registryAfterFirstRegistration);
  });

  it('still runs the newest body, not the one captured when the id was registered', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ execute }: { execute: () => void }) => useHarness([command({ execute })]),
      { wrapper, initialProps: { execute: first } }
    );

    rerender({ execute: second });
    act(() => {
      result.current.run('test:one');
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});

describe('useRunCommand', () => {
  it('refuses a disabled command', () => {
    const execute = vi.fn();
    const { result } = renderHook(
      () => useHarness([command({ execute, isEnabled: () => false })]),
      { wrapper }
    );

    act(() => {
      expect(result.current.run('test:one')).toBe(false);
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses an id nobody registered', () => {
    const { result } = renderHook(() => useHarness([command()]), { wrapper });

    act(() => {
      expect(result.current.run('test:missing')).toBe(false);
    });
  });
});

describe('useCommands', () => {
  it('sorts by category then label, so the palette does not depend on mount order', () => {
    const { result } = renderHook(
      () =>
        useHarness([
          command({ id: 'z', label: 'Zebra', category: 'View' }),
          command({ id: 'b', label: 'Beta', category: 'Notebook' }),
          command({ id: 'a', label: 'Alpha', category: 'View' }),
        ]),
      { wrapper }
    );

    expect(result.current.commands.map((c) => c.label)).toEqual(['Beta', 'Alpha', 'Zebra']);
  });
});
