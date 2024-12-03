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


// left statusBar
export const branchNameAtom = atom<string>("")
export const errorsCountAtom = atom<string>("")
export const warningsCountAtom = atom<string>("")

// right statusBar

export const linePositionAtom = atom<number>(0)
export const columnPositionAtom = atom<number>(0)
export const encodingAtom = atom<string>("UTF-8")
export const eolSequenceAtom = atom<string>("LF")
export const languageModeAtom = atom<string | null>("Launcher")
export const indentationModeAtom = atom<string>("Spaces")
export const indentationSizeAtom = atom<number>(2)
export const fontSizeAtom = atom<number>(16)


