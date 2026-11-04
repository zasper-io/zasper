import { useEffect, useRef, useState } from 'react';

import { NotebookCell } from '@/api';
import { kernelStatusWord } from '@/ide/KernelStatusDot';

/** The states a kernel is not yet usable in, and after which the next idle is worth saying. */
const UNSETTLED = ['starting', 'restarting', 'autorestarting', 'disconnected', 'connected'];

/** What the kernel going into a state is worth saying; busy and idle come with every run. */
function kernelNews(next: string): string | null {
  if (next === 'starting' || next === 'restarting' || next === 'autorestarting') {
    return `Kernel ${kernelStatusWord(next)}`;
  }
  if (next === 'dead') {
    return 'Kernel died';
  }
  if (next === 'disconnected') {
    return 'Kernel disconnected';
  }
  return null;
}

/** A cell that has just stopped running: finished, or the exception it raised. */
function cellNews(cells: NotebookCell[], id: string): string | null {
  const index = cells.findIndex((cell) => cell.id === id);
  if (index === -1) {
    return null;
  }
  const error = cells[index].outputs?.find((output) => output.output_type === 'error');
  return error === undefined
    ? `Cell ${index + 1} finished`
    : `Cell ${index + 1} raised ${String(error.ename ?? 'an error')}`;
}

/**
 * What the notebook says aloud, for a polite live region that is always mounted: a cell finishing or
 * failing, and the kernel starting, restarting, dying or coming back. A sighted reader sees the count
 * appear and the dot change colour; nothing told anyone else. The only cue was a spinner inserted
 * with its own `role="status"`, and a live region that arrives with its content is often not read.
 *
 * A repeat — the same cell finishing twice — has to be a change to be read again, so it gains a
 * no-break space.
 */
export function useNotebookAnnouncer(
  cells: NotebookCell[],
  running: ReadonlySet<string>,
  kernelStatus: string
): string {
  const [message, setMessage] = useState('');
  const say = (text: string) =>
    setMessage((previous) => (previous === text ? `${text}\u00a0` : text));

  // Read when a run ends rather than watched: typing changes the cells and ends nothing.
  const latestCells = useRef(cells);
  latestCells.current = cells;
  const wasRunning = useRef(running);
  useEffect(() => {
    const ended = [...wasRunning.current].filter((id) => !running.has(id));
    wasRunning.current = running;
    const news = ended
      .map((id) => cellNews(latestCells.current, id))
      .filter((text) => text !== null);
    if (news.length > 0) {
      say(news.join('. '));
    }
  }, [running]);

  // Ready is the first idle after any of UNSETTLED, however many busy-and-idles come between: a
  // restart here is a new session, and the kernel answers the new connection's first request (busy,
  // idle) before anything else.
  const settling = useRef(UNSETTLED.includes(kernelStatus));
  useEffect(() => {
    if (UNSETTLED.includes(kernelStatus)) {
      settling.current = true;
    } else if (kernelStatus === 'idle' && settling.current) {
      settling.current = false;
      say('Kernel ready');
      return;
    }
    const news = kernelNews(kernelStatus);
    if (news !== null) {
      say(news);
    }
  }, [kernelStatus]);

  return message;
}
