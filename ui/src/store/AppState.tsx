import { atom } from 'jotai';

// Define the interface for kernelspec and kernel
export interface IKernelspec {
  name: string;
  spec: {
    display_name: string;
    language?: string;
  };
  /** Jupyter serves logos under keys such as `logo-svg` and `logo-64x64`. */
  resources: Record<string, string>;
}

export interface IKernel {
  name: string;
  id: string;
}

export interface ITerminal {
  name: string;
  id: string;
}

// Define the structure of the kernelspecs and kernels state
export interface IKernelspecsState {
  [key: string]: IKernelspec;
}

export interface INotebookKernelMap {
  [key: string]: IKernel;
}

export interface ITerminalsState {
  [key: string]: ITerminal;
}

export const zasperVersionAtom = atom<string>('');
export const projectNameAtom = atom<string>('');
export const protectedStateAtom = atom<boolean>(false);
export const kernelspecsAtom = atom<IKernelspecsState>({});
export const notebookKernelMapAtom = atom<INotebookKernelMap>({});
/**
 * Busy, idle, connected or disconnected, by kernel id, for the kernels this window has a socket to.
 *
 * There is no server-side answer to draw on: `KernelManager.ExecutionState` is declared and never
 * written, so `/api/kernels` reports an empty string for every kernel. What a notebook works out from
 * its own IOPub `status` messages is therefore the only state there is, and this is how it reaches the
 * Jupyter info panel. A kernel missing from here is one nothing is known about, not an idle one.
 */
export const kernelStatusAtom = atom<Record<string, string>>({});
export const terminalsAtom = atom<ITerminalsState>({});
export const terminalsCountAtom = atom<number>(0);
export const userNameAtom = atom<string>('');
export const fileBrowserReloadCountAtom = atom<number>(0);

// left statusBar
export const branchNameAtom = atom<string>('');
export const errorsCountAtom = atom<string>('');
export const warningsCountAtom = atom<string>('');

// right statusBar

export const linePositionAtom = atom<number>(0);
export const columnPositionAtom = atom<number>(0);
export const encodingAtom = atom<string>('UTF-8');
export const eolSequenceAtom = atom<string>('LF');
export const indentationModeAtom = atom<string>('Spaces');
export const indentationSizeAtom = atom<number>(2);
// Drives the `.zfont-<n>` class on `.main-content` (see getFontClass in ide/IDE.tsx), which
// styles `.cm-editor`. One step above the 13px chrome.
export const fontSizeAtom = atom<number>(14);
