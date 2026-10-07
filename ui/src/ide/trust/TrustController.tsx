import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';

import { restartRestrictedLanguageServers } from '@/lsp/servers';
import { useKernelspecActions } from '@/store/kernelspecActions';
import { trustAtom, useAskTrust, useRefreshTrust } from '@/store/trust';

const ASKED = 'zasper.trust.asked:';

/** Whether this browser has already been asked about folder since it opened, and said to stay restricted. */
function alreadyAsked(folder: string): boolean {
  try {
    return sessionStorage.getItem(ASKED + folder) === '1';
  } catch {
    return false;
  }
}

function rememberAsked(folder: string): void {
  try {
    sessionStorage.setItem(ASKED + folder, '1');
  } catch {
    // A private window without storage asks again on the next load, which is the safe way to be wrong.
  }
}

/**
 * Reads whether the project is trusted, asks the question when it is not, and when it becomes trusted
 * brings back what restricted mode kept away: the project's .venv among the kernels, and the language
 * servers that were refused. A notebook starts its own kernel; see useKernelSession.
 */
export default function TrustController() {
  const trust = useAtomValue(trustAtom);
  const refresh = useRefreshTrust();
  const ask = useAskTrust();
  const { loadKernelspecs } = useKernelspecActions();
  const wasTrusted = useRef<boolean | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (trust === null) {
      return;
    }
    if (!trust.trusted && !alreadyAsked(trust.folder)) {
      rememberAsked(trust.folder);
      ask({ reason: 'open' });
    }
    if (wasTrusted.current === false && trust.trusted) {
      loadKernelspecs();
      restartRestrictedLanguageServers();
    }
    wasTrusted.current = trust.trusted;
  }, [trust, ask, loadKernelspecs]);

  return null;
}
