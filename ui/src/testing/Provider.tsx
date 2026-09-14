import React, { ReactNode, useState } from 'react';
import { createStore, Provider as JotaiProvider, WritableAtom } from 'jotai';

type AnyWritableAtom = WritableAtom<any, any[], any>;

interface ProviderProps {
  initialValues?: ReadonlyArray<readonly [AnyWritableAtom, unknown]>;
  children?: ReactNode;
}

/**
 * jotai's Provider with the `initialValues` jotai 2 took out of it, for tests that start a component
 * from a particular state: each atom is set on a fresh store before anything renders.
 */
export function Provider({ initialValues = [], children }: ProviderProps) {
  const [store] = useState(() => {
    const seeded = createStore();
    for (const [atom, value] of initialValues) {
      seeded.set(atom, value);
    }
    return seeded;
  });
  return <JotaiProvider store={store}>{children}</JotaiProvider>;
}
