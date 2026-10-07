import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import { getTrust, TrustState, trustFolder } from '@/api';

/** The answer from /api/trust, null until it has arrived. */
export const trustAtom = atom<TrustState | null>(null);

/** Restricted: the project's code does not run until it is trusted. False while the answer is pending. */
export const restrictedAtom = atom((get) => {
  const trust = get(trustAtom);
  return trust !== null && !trust.trusted;
});

/** Why the trust question is open, and what to do once the folder is trusted. */
export type TrustAsk =
  | { reason: 'open' }
  | { reason: 'run'; notebook: string; kernel: string; onTrusted: () => void }
  | { reason: 'other'; what: string; onTrusted?: () => void };

/** The trust question, open while this is set. */
export const trustAskAtom = atom<TrustAsk | null>(null);

/** Reads /api/trust into trustAtom. */
export function useRefreshTrust(): () => Promise<void> {
  const setTrust = useSetAtom(trustAtom);
  return useCallback(async () => {
    try {
      setTrust(await getTrust());
    } catch (error) {
      console.error('Could not read whether this folder is trusted:', error);
    }
  }, [setTrust]);
}

/** Trusts a folder, which is the project or one it is in, and takes the answer. */
export function useTrustFolder(): (path: string) => Promise<TrustState> {
  const setTrust = useSetAtom(trustAtom);
  return useCallback(
    async (path: string) => {
      const state = await trustFolder(path);
      setTrust(state);
      return state;
    },
    [setTrust]
  );
}

/** Opens the trust question. */
export function useAskTrust(): (ask: TrustAsk) => void {
  return useSetAtom(trustAskAtom);
}

export function useRestricted(): boolean {
  return useAtomValue(restrictedAtom);
}
