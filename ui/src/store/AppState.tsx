import { atom } from 'jotai';

import { storedZoomLevel } from '@/zoom';

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
/**
 * The absolute path of the project this server is serving, from `/api/info`, and `''` until that
 * answers. Separate from `projectNameAtom`, which holds the last segment upper-cased for display:
 * this one is an identity, and is what tells the remembered tabs of one project from another's.
 */
export const projectDirAtom = atom<string>('');
export const protectedStateAtom = atom<boolean>(false);
export const kernelspecsAtom = atom<IKernelspecsState>({});

/**
 * How the read of `/api/kernelspecs` went, which an empty `kernelspecsAtom` cannot say on its own.
 *
 * The launcher is the default tab, so it paints before the boot fetch has been sent: without this it
 * read `{}` and told everyone they had no kernels installed, on every cold start, and said the same
 * thing again when the request failed.
 */
export type KernelspecsStatus = 'loading' | 'ready' | 'failed';
export const kernelspecsStatusAtom = atom<KernelspecsStatus>('loading');
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
// The whole window's scale, applied to <html> by ide/zoom. Seeded from the browser rather than
// from 0, so a reload keeps the size the reader chose.
export const zoomLevelAtom = atom<number>(storedZoomLevel());
