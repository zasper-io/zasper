import { atom } from 'jotai';

export interface IfileTab {
  type: string;
  path: string;
  name: string;
  active: boolean;
  extension: string | null;
  load_required: boolean;
  kernelspec: string;
}

export interface IfileTabDict {
  [id: string]: IfileTab;
}

const defaultFileTabState: IfileTabDict = {
  Launcher: {
    type: 'launcher',
    path: 'Launcher',
    name: 'Launcher',
    active: true,
    extension: 'txt',
    load_required: false,
    kernelspec: 'none',
  },
};

export const fileTabsAtom = atom<IfileTabDict>(defaultFileTabState);
