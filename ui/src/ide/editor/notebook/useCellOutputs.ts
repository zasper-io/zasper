import { Dispatch, SetStateAction, useCallback, useRef } from 'react';

import { NotebookModel } from '@/api';

import { applyKernelMessage, carriesOutput, KernelMessage } from './kernelMessages';

/** What the kernel writes into the cells it runs: a clean slate when a run starts, then its output. */
export function useCellOutputs(setNotebook: Dispatch<SetStateAction<NotebookModel>>) {
  /**
   * The cells that have seen a `clear_output(wait=True)` and are still waiting for something to replace
   * what they show. A message that has been seen rather than the notebook's state, so it never reaches
   * the file.
   */
  const clearWaiting = useRef(new Set<string>());

  /** Clears the previous output and shows the running spinner (execution_count -1). */
  const markCellRunning = useCallback(
    (cellId: string) => {
      // A fresh run, so a clear left waiting by the last one is not waiting for anything any more.
      clearWaiting.current.delete(cellId);
      setNotebook((prevNotebook) => ({
        ...prevNotebook,
        cells: prevNotebook.cells.map((cell) =>
          cell.id === cellId ? { ...cell, execution_count: -1, outputs: [] } : cell
        ),
      }));
    },
    [setNotebook]
  );

  const clearCellOutputs = useCallback(
    (cellId: string) => {
      setNotebook((prevNotebook) => ({
        ...prevNotebook,
        cells: prevNotebook.cells.map((cell) =>
          cell.id === cellId ? { ...cell, outputs: [] } : cell
        ),
      }));
    },
    [setNotebook]
  );

  const applyMessage = useCallback(
    (message: KernelMessage, cellId: string | undefined) => {
      if (cellId && message.header.msg_type === 'clear_output') {
        if (message.content?.wait) {
          // Held until there is something to replace what is on screen: a progress line rewritten in a
          // loop must not blink empty between the frames.
          clearWaiting.current.add(cellId);
        } else {
          clearWaiting.current.delete(cellId);
          clearCellOutputs(cellId);
        }
        return;
      }

      // Read outside the updater, and only for a message that will produce an output: an updater has
      // to be pure, and React may call one more than once for a single message.
      const replaceOutputs =
        cellId !== undefined && carriesOutput(message) && clearWaiting.current.delete(cellId);

      setNotebook((prevNotebook) =>
        applyKernelMessage(prevNotebook, message, cellId, replaceOutputs)
      );
    },
    [clearCellOutputs, setNotebook]
  );

  return { markCellRunning, clearCellOutputs, applyMessage };
}
