import { atom } from 'jotai';

export interface IfileTab {
  type: string;
  path: string;
  name: string;
  active: boolean;
  extension: string | null;
  load_required: boolean;
  kernelspec: string;
  /** Terminals only: the folder the shell starts in, '' for the project root. */
  cwd?: string;
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

/** The path of the tab in front, for the surfaces outside the tab strip that mark it — the file browser. */
export const activeTabPathAtom = atom<string>((get) => {
  const active = Object.values(get(fileTabsAtom)).find((tab) => tab.active);
  return active === undefined ? '' : active.path;
});
