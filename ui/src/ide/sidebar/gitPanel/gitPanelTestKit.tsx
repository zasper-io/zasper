/** Fixtures and helpers GitPanel's tests share. The mocks are in gitPanelFakes.ts. */
import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { expect, vi } from 'vitest';

import GitPanel from './GitPanel';
import type { GitStatus } from '@/api';
import { useCommands, useRunCommand } from '@/commands/registry';
import { fileTabsAtom } from '@/store/tabState';
import {
  checkoutBranch,
  commitStaged,
  deleteBranch,
  discardFiles,
  fetchRemote,
  getBranches,
  getCommitDetail,
  getGitStatus,
  getLog,
  initRepository,
  pullRemote,
  pushRemote,
  stageFiles,
  unstageFiles,
} from './gitPanelFakes';

export const aCommit = {
  hash: 'abc1234def5678',
  shortHash: 'abc1234',
  subject: 'the first one',
  author: 'Test',
  date: '2026-01-02T03:04:05Z',
  parents: [] as string[],
};

/** The same commit with what it changed, which is what a row expands into. */
export const itsFiles = {
  ...aCommit,
  body: 'and more said about it underneath',
  files: [
    { path: 'src/notes.txt', status: 'M', insertions: 3, deletions: 1, isBinary: false },
    { path: 'logo.png', status: 'A', insertions: 0, deletions: 0, isBinary: true },
  ],
  insertions: 3,
  deletions: 1,
  truncated: false,
};

/** A page of the history, as the server sends it. */
export const aPage = (commits: (typeof aCommit)[], hasMore = false) => ({
  commits,
  hasMore,
  isRepository: true,
});

export const empty: GitStatus = {
  isRepository: true,
  gitAvailable: true,
  branch: 'main',
  upstream: '',
  ahead: 0,
  behind: 0,
  hasRemote: false,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
};

export const aStatus = (overrides: Partial<GitStatus> = {}): GitStatus => ({
  ...empty,
  ...overrides,
});

export const reveal = vi.fn();

/** The panel as the IDE renders it. Only the command tests care where `reveal` goes. */
export const ThePanel = ({ hidden }: { hidden?: boolean }) => (
  <GitPanel hidden={hidden ?? false} reveal={reveal} />
);

/** One of each: the branch that is checked out, another of this repository's, and a colleague's. */
export const theBranches = [
  { name: 'main', current: true, upstream: 'origin/main', isRemote: false },
  { name: 'topic', current: false, isRemote: false },
  { name: 'origin/theirs', current: false, isRemote: true },
];

/**
 * The panel with the diff tabs it has opened beside it, in a store of its own.
 *
 * A click on a file name has no effect inside the panel at all — what it does is open a tab — so the
 * tabs have to be readable from here for the assertion to be about anything.
 */
export function withTabs(element: ReactElement) {
  const OpenDiffs = () => {
    const tabs = useAtomValue(fileTabsAtom);
    return (
      <span data-testid="diffs">
        {Object.values(tabs)
          .filter((tab) => tab.type === 'diff')
          .map((tab) => `${tab.path} ${JSON.stringify(tab.diff)}`)
          .join(',')}
      </span>
    );
  };

  return render(
    <Provider>
      {element}
      <OpenDiffs />
    </Provider>
  );
}

/**
 * The panel and the command palette over one store, a button per registered command.
 *
 * The palette is the whole way in for these: there is nothing on the panel that runs them, and the
 * registry is per-store, so the two have to be rendered under the same Provider to meet at all.
 */
export function withPalette(hidden = false) {
  const Palette = () => {
    const commands = useCommands();
    const run = useRunCommand();

    return (
      <>
        {commands.map((command) => (
          <button key={command.id} data-testid={command.id} onClick={() => run(command.id)}>
            {command.label}
          </button>
        ))}
      </>
    );
  };

  return render(
    <Provider>
      <ThePanel hidden={hidden} />
      <Palette />
    </Provider>
  );
}

/** Opens the branch menu, which the branch name in the bar is the button for. */
export async function openBranchMenu(): Promise<void> {
  fireEvent.click(await screen.findByLabelText('Branch: main'));
  await waitFor(() => expect(getBranches).toHaveBeenCalled());
}

/** What every GitPanel test starts from. */
export function setUpGitPanel() {
  vi.clearAllMocks();
  getGitStatus.mockResolvedValue(aStatus());
  getLog.mockResolvedValue(aPage([]));
  getCommitDetail.mockResolvedValue(itsFiles);
  initRepository.mockResolvedValue(aStatus());
  stageFiles.mockResolvedValue(aStatus());
  unstageFiles.mockResolvedValue(aStatus());
  discardFiles.mockResolvedValue(aStatus());
  commitStaged.mockResolvedValue(aStatus());
  getBranches.mockResolvedValue({ branches: theBranches, isRepository: true });
  checkoutBranch.mockResolvedValue(aStatus({ branch: 'topic' }));
  deleteBranch.mockResolvedValue(aStatus());
  fetchRemote.mockResolvedValue(aStatus());
  pullRemote.mockResolvedValue(aStatus());
  pushRemote.mockResolvedValue(aStatus());
}
