/** Fixtures and helpers FileBrowser's tests share. The mocks are in fileBrowserFakes.ts. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { vi } from 'vitest';

import FileBrowser from './FileBrowser';
import { fileTabsAtom } from '@/store/tabState';
import { terminalsAtom } from '@/store/terminals';
import {
  copyContent,
  copyToClipboard,
  createContent,
  deleteContent,
  downloadContent,
  getDirectory,
  moveContent,
  renameContent,
  saveAs,
  uploadFile,
} from './fileBrowserFakes';

export const rootListing = {
  name: '',
  path: '',
  type: 'directory',
  content: [
    { name: 'src', path: 'src', type: 'directory', content: [] },
    { name: 'notes.txt', path: 'notes.txt', type: 'file', content: [] },
    {
      name: 'build.log',
      path: 'build.log',
      type: 'file',
      content: [],
      size: 2048,
      last_modified: '2026-01-02T03:04:05Z',
      writable: false,
      ignored: true,
    },
    { name: '.env', path: '.env', type: 'file', content: [] },
  ],
};

export const srcListing = {
  name: 'src',
  path: 'src',
  type: 'directory',
  content: [{ name: 'main.py', path: 'src/main.py', type: 'file', content: [] }],
};

/** The tabs the panel has opened, Launcher aside, and the shells it has started. */
export function OpenTabs() {
  const tabs = useAtomValue(fileTabsAtom);
  const terminals = useAtomValue(terminalsAtom);
  return (
    <>
      <span data-testid="tabs">
        {Object.keys(tabs)
          .filter((key) => key !== 'Launcher')
          .join(',')}
      </span>
      <span data-testid="terminals">{Object.keys(terminals).join(',')}</span>
    </>
  );
}

export let tree: HTMLElement;

export async function renderBrowser() {
  const { container } = render(
    <Provider>
      <FileBrowser hidden={false} reloadCount={0} />
      <OpenTabs />
    </Provider>
  );
  // Scoped to the tree, so the open-tabs readout above cannot answer a query about a row.
  tree = container.querySelector('.content-inner') as HTMLElement;
  await within(tree).findByText('notes.txt');
}

/** The clickable row for a name, which is what carries the open/active state. */
export function row(name: string): HTMLElement {
  // Not the tooltip's copy of the name: a row that has the keyboard shows one, and its first line is
  // the path.
  return within(tree)
    .getByText(name, { selector: ':not(.z-tooltip-line)' })
    .closest('a') as HTMLElement;
}

/**
 * What the row says when the keyboard reaches it, which is a real tooltip rather than a `title`. The
 * keyboard rather than a pointer because it needs no delay run down, and it is the same box.
 */
export function rowTooltip(name: string): string {
  const item = row(name).closest('li') as HTMLElement;
  item.focus();
  fireEvent.focusIn(item);
  const text = screen.getByRole('tooltip').textContent ?? '';
  fireEvent.focusOut(item);
  return text;
}

export function openMenu(name: string, item: string) {
  fireEvent.contextMenu(row(name));
  fireEvent.click(screen.getByText(item));
}

export function openTabs(): string {
  return screen.getByTestId('tabs').textContent ?? '';
}

/** The shells this window has open, which is where a terminal goes instead of a tab. */
export function runningTerminals(): string {
  return screen.getByTestId('terminals').textContent ?? '';
}

/** Expands `src` and waits for what it holds. */
export async function expandSrc() {
  fireEvent.click(row('src'));
  await within(tree).findByText('main.py');
}

/** What every FileBrowser test starts from. */
export function setUpFileBrowser() {
  // The panel opens a watch socket on mount, which has nothing to say to a test and no backend to
  // say it to.
  vi.stubGlobal(
    'WebSocket',
    class {
      close() {}
    }
  );
  [
    getDirectory,
    createContent,
    renameContent,
    deleteContent,
    moveContent,
    copyContent,
    downloadContent,
    uploadFile,
    saveAs,
    copyToClipboard,
  ].forEach((mock) => mock.mockReset());
  getDirectory.mockImplementation((path: string) =>
    Promise.resolve(path === '' ? rootListing : srcListing)
  );
  createContent.mockResolvedValue({});
  renameContent.mockResolvedValue(undefined);
  deleteContent.mockResolvedValue(undefined);
  moveContent.mockResolvedValue(undefined);
  copyContent.mockResolvedValue(undefined);
  downloadContent.mockResolvedValue(new Blob(['hello']));
  uploadFile.mockResolvedValue({});
  copyToClipboard.mockResolvedValue(true);
}
