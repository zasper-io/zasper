import { sendTelemetry } from '@/api/telemetry';

import {
  isReportableCommandId,
  normalizeExtension,
  TelemetryEvent,
  TelemetryEventName,
} from './events';

/** Matches maxEventsPerReq on the Go side, so a flush is never rejected for being too big. */
const MAX_BATCH = 20;

/**
 * Long enough that running a notebook cell by cell is one request rather than twenty, short enough
 * that a browser closed mid-session loses almost nothing.
 */
const FLUSH_INTERVAL_MS = 5000;

let buffer: TelemetryEvent[] = [];
let enabled = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Whether to collect at all. Off until the server says otherwise, so a session that starts with
 * `--tracking=false` never queues anything, let alone sends it.
 */
export function setEnabled(on: boolean): void {
  enabled = on;
  if (!on) {
    buffer = [];
    clearTimer();
  }
}

export function isEnabled(): boolean {
  return enabled;
}

function clearTimer(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}

/** Sends whatever has been collected. Safe to call when there is nothing. */
export function flush(): void {
  clearTimer();
  if (buffer.length === 0) {
    return;
  }
  const batch = buffer;
  buffer = [];
  sendTelemetry(batch);
}

function schedule(): void {
  if (timer !== undefined) {
    return;
  }
  timer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

/**
 * Records one event, if tracking is on. Nothing here throws and nothing here blocks: telemetry that
 * can break the thing it is measuring is worse than no telemetry.
 */
export function track(
  event: TelemetryEventName,
  properties?: Record<string, string | number | boolean>
): void {
  if (!enabled) {
    return;
  }

  buffer.push(properties === undefined ? { event } : { event, properties });

  if (buffer.length >= MAX_BATCH) {
    flush();
    return;
  }
  schedule();
}

/** A tab the user just opened, as against one they switched back to. */
export function trackTabOpened(type: string, name: string): void {
  if (type === 'notebook') {
    track('notebook_opened');
    return;
  }
  // Terminals are counted by the server when the shell actually starts, and a launcher is not a file.
  if (type === 'terminal' || type === 'launcher') {
    return;
  }
  track('file_opened', { extension: normalizeExtension(name) });
}

/** A command the user ran, from the palette, a keybinding or a button. */
export function trackCommand(id: string): void {
  if (!isReportableCommandId(id)) {
    return;
  }
  track('command_executed', { command_id: id });
}

/**
 * Sends the last batch as the page goes away. `pagehide` rather than `beforeunload`, which does not
 * fire on mobile or when a tab is discarded, and the request is a keepalive one so it outlives the
 * document that started it.
 */
export function installFlushOnUnload(): () => void {
  const onHide = () => flush();
  window.addEventListener('pagehide', onHide);
  return () => window.removeEventListener('pagehide', onHide);
}
