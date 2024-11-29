import { atom } from 'jotai'

// Define the interface for kernelspec
export interface IKernelspec {
  name: string;
  spec: string;
  resources: {
    'logo-64x64': string;
  };
}

// Define the structure of the kernelspecs state
export interface IKernelspecsState {
  [key: string]: IKernelspec;
}

export const kernelspecsAtom = atom<IKernelspecsState>({})
