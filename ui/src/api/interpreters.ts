import { requestJson } from './client';

/** A Python Settings offers as the default interpreter. */
export interface PythonInstall {
  executable: string;
  version: string;
  /** Where it came from: Homebrew, pyenv, the folder a virtual environment is in. */
  where: string;
}

export interface InterpreterChoice {
  /** The Python chosen in Settings, '' for automatic. */
  chosen: string;
  /** What automatic means in this project: its .venv's Python, or '' for the shell's `python3`. */
  automatic: string;
  interpreters: PythonInstall[];
}

export function getInterpreters(): Promise<InterpreterChoice> {
  return requestJson<InterpreterChoice>('/api/interpreters');
}
