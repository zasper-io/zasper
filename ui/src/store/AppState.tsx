import { atom } from 'jotai';

// Define the interface for kernelspec and kernel
export interface IKernelspec {
  name: string;
  spec: string;
  resources: {
    'logo-64x64': string;
  };
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

export interface IKernelsState {
  [key: string]: IKernel;
}

export interface ITerminalsState {
  [key: string]: ITerminal;
}

export const zasperVersionAtom = atom<string>('');
export const projectNameAtom = atom<string>('');
export const kernelspecsAtom = atom<IKernelspecsState>({});
export const kernelsAtom = atom<IKernelsState>({});
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
export const languageModeAtom = atom<string | null>('Launcher');
export const indentationModeAtom = atom<string>('Spaces');
export const indentationSizeAtom = atom<number>(2);
export const fontSizeAtom = atom<number>(16);
