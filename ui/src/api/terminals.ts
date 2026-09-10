import { requestEmpty, requestJson } from './client';

/**
 * A shell as `/api/terminals` reports it.
 *
 * The id and the name are not the same thing, which they are for a kernel. A terminal is named after
 * the tab it is drawn in, and every window numbers its tabs from one, so two windows with a terminal
 * each produce two sessions both called `Terminal 1`. Shutting one down names the id.
 */
export interface ITerminalModel {
  id: string;
  name: string;
  /** Where the shell is, relative to the project root; empty for the root itself. */
  dir: string;
  /** RFC 3339, UTC. When the shell was started. */
  started: string;
}

/**
 * Every shell this server is running, which is not the same as every terminal tab this window has
 * open: a reload loses the second list and not the first, and a shell that has exited is gone from
 * the first while its tab is still on screen.
 */
export function listTerminals(): Promise<ITerminalModel[]> {
  return requestJson<ITerminalModel[]>('/api/terminals');
}

/** Kills the shell. The tab it was drawn in stays open, showing what it last printed. */
export function deleteTerminal(terminalId: string): Promise<void> {
  return requestEmpty(`/api/terminals/${encodeURIComponent(terminalId)}`, { method: 'DELETE' });
}
