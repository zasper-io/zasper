import { useCallback, useState } from 'react';

import { KernelMessage } from './kernelMessages';

/** The kernel's `input_request` — what `input()` in a cell turns into — shown under the cell that ran it. */
export function useInputPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptContent, setPromptContent] = useState<KernelMessage>();
  const [promptCellId, setPromptCellId] = useState<string>();

  const askForInput = useCallback((request: KernelMessage, cellId: string | undefined) => {
    setShowPrompt(true);
    setPromptContent(request);
    setPromptCellId(cellId);
  }, []);

  const toggleShowPrompt = useCallback(() => setShowPrompt((prev) => !prev), []);

  return { showPrompt, promptContent, promptCellId, askForInput, toggleShowPrompt };
}
