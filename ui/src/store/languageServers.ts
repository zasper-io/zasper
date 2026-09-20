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
  /** A notebook's problems say which cell, and count lines within it. */
  cell?: number;
  /** From 0, as the protocol counts. */
  line: number;
  character: number;
}

/** Every file's problems as its server last published them, by project-relative path. */
export const problemsAtom = atom<Record<string, Problem[]>>({});

/** Whether the panel under the editor is open, which is where problems and references are read. */
export const dockOpenAtom = atom(false);

/** Which of the panel's three is in front: two lists and, since story 4, the shells. */
export type DockTab = 'problems' | 'references' | 'terminal';

export const dockTabAtom = atom<DockTab>('problems');

/** A position asked for from the Problems panel, for the file editor holding the file to go to. */
export const revealPositionAtom = atom<{
  path: string;
  cell?: number;
  line: number;
  character: number;
} | null>(null);

/** The server serving each open notebook, by path — the kernel's language decides it, not the name. */
export const notebookServersAtom = atom<Record<string, string>>({});

/**
 * The interpreter each server was told to read imports with, by server key, so the status bar can say it.
 * Empty for a language whose kernel names none, and for every server that needs no interpreter.
 */
export const serverInterpretersAtom = atom<Record<string, string>>({});

/** What discovery answered for every language, loaded at boot and again after Settings change. */
export const languageServerListAtom = atom<import('@/api').LanguageServerList | null>(null);
