import { atom } from 'jotai';

/** Where one language's server stands, for the status bar. */
export type ServerState = 'starting' | 'ready' | 'failed' | 'missing' | 'off';

export interface ServerStatus {
  state: ServerState;
  /** The server as it named itself, or as discovery named it. */
  name: string;
  version?: string;
  /** Why it failed, in the server's or Zasper's words. */
  message?: string;
}

/** By server key: `go`, `python`. */
export const serverStatusAtom = atom<Record<string, ServerStatus>>({});

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Problem {
  severity: Severity;
  message: string;
  source?: string;
  code?: string;
  /** From 0, as the protocol counts. */
  line: number;
  character: number;
}

/** Every file's problems as its server last published them, by project-relative path. */
export const problemsAtom = atom<Record<string, Problem[]>>({});

/** Whether the panel under the editor is open, which is where problems and references are read. */
export const dockOpenAtom = atom(false);

/** Which of the panel's lists is in front. */
export type DockTab = 'problems' | 'references';

export const dockTabAtom = atom<DockTab>('problems');

/** A position asked for from the Problems panel, for the file editor holding the file to go to. */
export const revealPositionAtom = atom<{ path: string; line: number; character: number } | null>(
  null
);

/** What discovery answered for every language, loaded at boot and again after Settings change. */
export const languageServerListAtom = atom<import('@/api').LanguageServerList | null>(null);
