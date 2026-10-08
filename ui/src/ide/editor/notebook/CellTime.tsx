import { useEffect, useState } from 'react';

import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import { CellTiming } from './kernelMessages';

/**
 * A duration as a cell's border says it: `0.4 s`, `12.3 s`, `2 min 14 s`, `1 h 3 min`. Under a tenth of a
 * second is `<0.1 s` rather than `0.0 s`, which would read as not having run.
 */
export function formatDuration(ms: number): string {
  if (ms < 100) {
    return '<0.1 s';
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  }
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}

/** A running count, in whole seconds so it does not flicker: `12 s`, `2 min 14 s`. */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) {
    return `${seconds} s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  }
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}

/** The exact time, for the tooltip: `12.34 s`, `2 min 14.3 s`. */
function formatExact(ms: number): string {
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${((ms - minutes * 60_000) / 1000).toFixed(1)} s`;
}

const clock = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** `· 7 Oct` for a run on another day than today, so a stale number is not taken for this morning's. */
function dayOf(date: Date): string {
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? ''
    : ` · ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

interface CellTimeProps {
  timing: CellTiming | undefined;
  isRunning: boolean;
}

/**
 * How long a code cell took, set in its box's bottom border at the left, under its kind in the top
 * border. While the kernel is on it the count goes up in the accent; a cell waiting behind
 * another says `queued`; one that has never run says nothing. The time runs from execute_input to
 * execute_reply, the kernel's own, and the tooltip adds when it ran and how long it waited first.
 */
export default function CellTime({ timing, isRunning }: CellTimeProps) {
  const tip = useTooltip();
  const started = timing?.['iopub.execute_input'];
  const finished = timing?.['shell.execute_reply'];
  const running = isRunning && started !== undefined && finished === undefined;

  // One tick a second while running; nothing at all otherwise.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) {
      return;
    }
    setNow(Date.now());
    const ticking = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(ticking);
  }, [running]);

  if (isRunning && !running) {
    return <span className="cellTime is-queued">queued</span>;
  }
  if (running) {
    return (
      <span className="cellTime is-running" role="timer">
        running · {formatElapsed(now - Date.parse(started))}
      </span>
    );
  }
  if (started === undefined || finished === undefined) {
    return null;
  }

  const from = new Date(started);
  const to = new Date(finished);
  const took = to.getTime() - from.getTime();
  if (!Number.isFinite(took) || took < 0) {
    return null;
  }
  const sent = timing?.sent ? Date.parse(timing.sent) : NaN;
  const waited = from.getTime() - sent;
  const lines = [
    `Started ${clock(from)}`,
    `Finished ${clock(to)}`,
    `Took ${formatExact(took)}`,
    ...(Number.isFinite(waited) && waited > 0
      ? [`Waited ${formatExact(waited)} in the queue`]
      : []),
  ];

  return (
    <>
      <span
        className="cellTime"
        tabIndex={-1}
        aria-label={`Took ${formatExact(took)}`}
        {...tip.anchorProps}
      >
        {formatDuration(took)}
        {dayOf(to)}
      </span>
      <Tooltip tip={tip} label={lines} />
    </>
  );
}
