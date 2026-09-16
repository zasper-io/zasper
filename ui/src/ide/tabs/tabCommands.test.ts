import { describe, expect, it } from 'vitest';

import type { FileTab, FileTabDict } from '@/store/tabState';
import { tabFilePath, tabsToClose } from './tabCommands';

function tab(path: string, type = 'file'): FileTab {
  return {
    type,
    path,
    name: path,
    active: false,
    extension: 'txt',
    load_required: false,
    kernelspec: 'none',
  };
}

const strip: FileTabDict = {
  Launcher: tab('Launcher', 'launcher'),
  'a.txt': tab('a.txt'),
  'b.py': tab('b.py'),
  Settings: tab('Settings', 'settings'),
};

describe('tabsToClose', () => {
  it('takes the tab it was asked on', () => {
    expect(tabsToClose(strip, 'b.py', 'this', {})).toEqual(['b.py']);
  });

  it('never takes the Launcher', () => {
    expect(tabsToClose(strip, 'Launcher', 'this', {})).toEqual([]);
    expect(tabsToClose(strip, 'b.py', 'all', {})).toEqual(['a.txt', 'b.py', 'Settings']);
    expect(tabsToClose(strip, 'a.txt', 'left', {})).toEqual([]);
  });

  it('measures the others, the left and the right from the tab, in strip order', () => {
    expect(tabsToClose(strip, 'b.py', 'others', {})).toEqual(['a.txt', 'Settings']);
    expect(tabsToClose(strip, 'b.py', 'left', {})).toEqual(['a.txt']);
    expect(tabsToClose(strip, 'b.py', 'right', {})).toEqual(['Settings']);
  });

  it('leaves unsaved files out of Close Saved, and counts a tab with no file as saved', () => {
    const unsaved = { 'a.txt': () => Promise.resolve() };
    expect(tabsToClose(strip, 'b.py', 'saved', unsaved)).toEqual(['b.py', 'Settings']);
  });

  it('takes nothing for a tab that is not open', () => {
    expect(tabsToClose(strip, 'gone.txt', 'all', {})).toEqual([]);
  });
});

describe('tabFilePath', () => {
  it('is the file for a file, and the compared file for a diff', () => {
    expect(tabFilePath(tab('src/a.txt'))).toBe('src/a.txt');
    expect(
      tabFilePath({ ...tab('diff:staged:src/a.txt', 'diff'), diff: { path: 'src/a.txt' } })
    ).toBe('src/a.txt');
  });

  it('is null for the tabs that are not a file', () => {
    expect(tabFilePath(tab('Launcher', 'launcher'))).toBeNull();
    expect(tabFilePath(tab('zasper:help', 'help'))).toBeNull();
  });
});
