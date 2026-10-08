import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';

import { NotebookModel } from '@/api';
import { editorSettingsAtom } from '@/store/settings';

import {
  applyKernelMessage,
  applyReplayedRuns,
  carriesOutput,
  CellTiming,
  KernelMessage,
  nextTiming,
  PlacedRun,
} from './kernelMessages';

/** What the kernel writes into the cells it runs: a clean slate when a run starts, then its output. */
export function useCellOutputs(setNotebook: Dispatch<SetStateAction<NotebookModel>>) {
  /**
   * The cells that have seen a `clear_output(wait=True)` and are still waiting for something to replace
   * what they show. A message that has been seen rather than the notebook's state, so it never reaches
   * the file.
   */
  const clearWaiting = useRef(new Set<string>());

  /**
   * When each cell's latest run happened, as this page saw it: what a cell shows its time from, whether
   * or not the times are written into the file. A cell this page has not seen run shows what the file
   * holds instead.
   */
  const [timings, setTimings] = useState<Record<string, CellTiming>>({});
  const recordTiming = useAtomValue(editorSettingsAtom).record_timing;
  // Read inside callbacks that must keep their identity: the kernel session holds on to them.
  const recording = useRef(recordTiming);
  useEffect(() => {
    recording.current = recordTiming;
  }, [recordTiming]);

  /** Clears the previous output and shows the running spinner (execution_count -1). */
  const markCellRunning = useCallback(
    (cellId: string) => {
      // A fresh run, so a clear left waiting by the last one is not waiting for anything any more.
      clearWaiting.current.delete(cellId);
      const sent = new Date().toISOString();
      setTimings((previous) => ({ ...previous, [cellId]: { sent } }));
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

      if (cellId !== undefined) {
        setTimings((previous) => {
          const next = nextTiming(previous[cellId], message);
          return next ? { ...previous, [cellId]: next } : previous;
        });
      }
      const record = recording.current;
      setNotebook((prevNotebook) =>
        applyKernelMessage(prevNotebook, message, cellId, replaceOutputs, record)
      );
    },
    [clearCellOutputs, setNotebook]
  );

  /** Takes the runs the server kept while this page was not listening. */
  const applyReplay = useCallback(
    (placed: PlacedRun[]) => {
      for (const { cellId, run } of placed) {
        if (!run.done && run.clear_waiting) {
          clearWaiting.current.add(cellId);
        } else {
          clearWaiting.current.delete(cellId);
        }
      }
      // A run still going counts up from when the server saw it start; a finished one says its time.
      const timed = placed.filter(({ run }) => run.execution);
      if (timed.length > 0) {
        setTimings((previous) => ({
          ...previous,
          ...Object.fromEntries(timed.map(({ cellId, run }) => [cellId, run.execution!])),
        }));
      }
      const record = recording.current;
      setNotebook((prevNotebook) => applyReplayedRuns(prevNotebook, placed, record));
    },
    [setNotebook]
  );

  return { markCellRunning, clearCellOutputs, applyMessage, applyReplay, timings };
}
