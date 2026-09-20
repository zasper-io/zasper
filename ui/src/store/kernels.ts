import { atom } from 'jotai';

export interface Kernelspec {
  name: string;
  /**
   * Zasper's own: the executable this kernel would be launched with, resolved by the server. A spec
   * written by hand names `python`, which only a PATH can resolve, and the browser has none.
   */
  interpreter?: string;
  spec: {
    display_name: string;
    language?: string;
    /** The command the kernel is started with; its first word is the interpreter. */
    argv?: string[];
  };
  /** Logos, under keys such as `logo-svg` and `logo-64x64`. */
  resources: Record<string, string>;
}

export interface Kernel {
  name: string;
  id: string;
}

export interface KernelspecsState {
  [key: string]: Kernelspec;
}

export interface NotebookKernelMap {
  [key: string]: Kernel;
}

export const kernelspecsAtom = atom<KernelspecsState>({});

/**
 * How the read of /api/kernelspecs went, which an empty list cannot say: the launcher paints before
 * the read answers, and would otherwise report no kernels installed.
 */
export type KernelspecsStatus = 'loading' | 'ready' | 'failed';
export const kernelspecsStatusAtom = atom<KernelspecsStatus>('loading');

export const notebookKernelMapAtom = atom<NotebookKernelMap>({});

/**
 * Busy, idle, connected or disconnected, by kernel id, for the kernels this window has a socket to,
 * from each notebook's own IOPub `status` messages. A kernel missing here is unknown, not idle.
 */
export const kernelStatusAtom = atom<Record<string, string>>({});
