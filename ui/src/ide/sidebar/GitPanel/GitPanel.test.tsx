import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GitPanel from './GitPanel';
import type { GitStatus } from '@/api';

const getGitStatus = vi.fn();
const getCommitGraph = vi.fn();
const stageFiles = vi.fn();
const unstageFiles = vi.fn();
const discardFiles = vi.fn();
const commitStaged = vi.fn();
const getBranches = vi.fn();
const checkoutBranch = vi.fn();
const deleteBranch = vi.fn();
const fetchRemote = vi.fn();
const pullRemote = vi.fn();
const pushRemote = vi.fn();

vi.mock('@/api', async () => ({
  getGitStatus: () => getGitStatus(),
  getCommitGraph: () => getCommitGraph(),
  stageFiles: (paths: string[]) => stageFiles(paths),
  unstageFiles: (paths: string[]) => unstageFiles(paths),
  discardFiles: (paths: string[], deleteUntracked: boolean) => discardFiles(paths, deleteUntracked),
  commitStaged: (message: string, options: unknown) => commitStaged(message, options),
  getBranches: () => getBranches(),
  checkoutBranch: (...args: unknown[]) => checkoutBranch(...args),
  deleteBranch: (...args: unknown[]) => deleteBranch(...args),
  fetchRemote: () => fetchRemote(),
  pullRemote: () => pullRemote(),
  pushRemote: () => pushRemote(),
  emptyGitStatus: (await import('@/api/git')).emptyGitStatus,
  apiErrorMessage: (await import('@/api/client')).apiErrorMessage,
}));

// The panel raises toasts for what it did; whether they render is IDE.tsx's business, not this test's.
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const aCommit = {
  hash: 'abc123',
  message: 'the first one',
  author: 'Test',
  date: '2026-01-02',
  parents: [] as string[],
};

const empty: GitStatus = {
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

const aStatus = (overrides: Partial<GitStatus> = {}): GitStatus => ({ ...empty, ...overrides });

/** One of each: the branch that is checked out, another of this repository's, and a colleague's. */
const theBranches = [
  { name: 'main', current: true, upstream: 'origin/main', isRemote: false },
  { name: 'topic', current: false, isRemote: false },
  { name: 'origin/theirs', current: false, isRemote: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  getGitStatus.mockResolvedValue(aStatus());
  getCommitGraph.mockResolvedValue({ commits: [], isRepository: true });
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
});

/** Opens the branch menu, which the branch name in the bar is the button for. */
async function openBranchMenu(): Promise<void> {
  fireEvent.click(await screen.findByLabelText('Branch: main'));
  await waitFor(() => expect(getBranches).toHaveBeenCalled());
}

describe('GitPanel', () => {
  it('asks the server for nothing while it is hidden', async () => {
    render(<GitPanel hidden />);

    // Every sidebar panel stays mounted, so an unguarded fetch here is a request on every boot for a
    // panel nobody opened.
    await waitFor(() => expect(screen.getByText('Source control')).toBeInTheDocument());
    expect(getGitStatus).not.toHaveBeenCalled();
    expect(getCommitGraph).not.toHaveBeenCalled();
  });

  it('fetches when it is opened', async () => {
    const { rerender } = render(<GitPanel hidden />);
    rerender(<GitPanel hidden={false} />);

    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(1));
    expect(getCommitGraph).toHaveBeenCalledTimes(1);
  });

  it('says a project is not a repository rather than that it has nothing to commit', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ isRepository: false, gitAvailable: true, branch: '' })
    );
    getCommitGraph.mockResolvedValue({ commits: [], isRepository: false });
    render(<GitPanel hidden={false} />);

    expect(await screen.findByText('This project is not a git repository.')).toBeInTheDocument();
    // Nothing on it could work, so the commit form is not offered.
    expect(screen.queryByPlaceholderText('Commit message')).not.toBeInTheDocument();
    expect(screen.queryByText('No changes.')).not.toBeInTheDocument();
    expect(await screen.findByText('No history.')).toBeInTheDocument();
  });

  it('shows an empty repository as a repository with no changes', async () => {
    render(<GitPanel hidden={false} />);

    expect(await screen.findByText('No changes.')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(await screen.findByText('No history.')).toBeInTheDocument();
  });

  it('separates what is staged from what is not, and shows a file in both when it is both', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({
        staged: [{ path: 'src/notes.txt', staged: 'M', worktree: 'M' }],
        unstaged: [{ path: 'src/notes.txt', staged: 'M', worktree: 'M' }],
        untracked: [{ path: 'scratch.txt', staged: '?', worktree: '?' }],
      })
    );
    getCommitGraph.mockResolvedValue({ commits: [aCommit], isRepository: true });
    render(<GitPanel hidden={false} />);

    expect(await screen.findByText('Staged')).toBeInTheDocument();
    expect(screen.getByText('Changes')).toBeInTheDocument();
    expect(screen.getByText('Untracked')).toBeInTheDocument();
    // The panel used to hide anything staged and not further modified, so this is the bug that had to
    // stay fixed: one path, two sections, because the two halves of the index disagree.
    expect(screen.getByLabelText('Unstage src/notes.txt')).toBeInTheDocument();
    expect(screen.getByLabelText('Stage src/notes.txt')).toBeInTheDocument();
    // The name is the file, the folder is beside it: two sections mentioning src/notes.txt is exactly
    // the case where the bare name would not be enough.
    expect(screen.getAllByText('notes.txt')).toHaveLength(2);
    expect(screen.getAllByText('src')).toHaveLength(2);
    expect(await screen.findByText(/the first one -- Test/)).toBeInTheDocument();
  });

  it('stages and unstages the path the button belongs to', async () => {
    const both = aStatus({
      staged: [{ path: 'a.txt', staged: 'A', worktree: '' }],
      unstaged: [{ path: 'b.txt', staged: '', worktree: 'M' }],
    });
    getGitStatus.mockResolvedValue(both);
    // The panel redraws itself from what the write answered with, so both rows have to survive the
    // first click for the second to be there to make.
    stageFiles.mockResolvedValue(both);
    render(<GitPanel hidden={false} />);

    fireEvent.click(await screen.findByLabelText('Stage b.txt'));
    await waitFor(() => expect(stageFiles).toHaveBeenCalledWith(['b.txt']));

    fireEvent.click(screen.getByLabelText('Unstage a.txt'));
    await waitFor(() => expect(unstageFiles).toHaveBeenCalledWith(['a.txt']));
  });

  it('stages a whole section at once', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({
        unstaged: [
          { path: 'a.txt', staged: '', worktree: 'M' },
          { path: 'b.txt', staged: '', worktree: 'D' },
        ],
      })
    );
    render(<GitPanel hidden={false} />);

    fireEvent.click(await screen.findByLabelText('Stage all'));
    await waitFor(() => expect(stageFiles).toHaveBeenCalledWith(['a.txt', 'b.txt']));
  });

  it('asks before discarding, and says an untracked file will be deleted', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ untracked: [{ path: 'scratch.txt', staged: '?', worktree: '?' }] })
    );
    render(<GitPanel hidden={false} />);

    fireEvent.click(await screen.findByLabelText('Discard scratch.txt'));
    expect(await screen.findByText('Discard changes')).toBeInTheDocument();
    expect(screen.getByText(/not tracked by git/)).toBeInTheDocument();
    // Nothing has gone yet: there is no undo, so the dialog is the only thing between a click and a
    // deleted file.
    expect(discardFiles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    // The second argument is what tells the server the delete is meant; without it the server refuses.
    await waitFor(() => expect(discardFiles).toHaveBeenCalledWith(['scratch.txt'], true));
  });

  it('discards nothing when the dialog is dismissed', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ unstaged: [{ path: 'notes.txt', staged: '', worktree: 'M' }] })
    );
    render(<GitPanel hidden={false} />);

    fireEvent.click(await screen.findByLabelText('Discard notes.txt'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Discard changes')).not.toBeInTheDocument();
    expect(discardFiles).not.toHaveBeenCalled();
  });

  it('commits what is staged and nothing else', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({
        staged: [{ path: 'a.txt', staged: 'A', worktree: '' }],
        unstaged: [{ path: 'b.txt', staged: '', worktree: 'M' }],
      })
    );
    render(<GitPanel hidden={false} />);

    const message = await screen.findByPlaceholderText('Commit message');
    fireEvent.change(message, { target: { value: 'the first one' } });
    fireEvent.click(screen.getByRole('button', { name: /^Commit/ }));

    // No file list goes with it. The previous panel sent one and the server committed everything
    // anyway; now what is committed is what the Staged section holds.
    await waitFor(() =>
      expect(commitStaged).toHaveBeenCalledWith('the first one', { push: false })
    );
    await waitFor(() => expect(message).toHaveValue(''));
  });

  it('shows the commit it just made in the history below the box that made it', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ staged: [{ path: 'a.txt', staged: 'A', worktree: '' }] })
    );
    render(<GitPanel hidden={false} />);
    await waitFor(() => expect(getCommitGraph).toHaveBeenCalledTimes(1));

    getCommitGraph.mockResolvedValue({ commits: [aCommit], isRepository: true });
    fireEvent.change(await screen.findByPlaceholderText('Commit message'), {
      target: { value: 'the first one' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Commit/ }));

    // The history is its own read, so without this it stayed as it was when the panel was opened —
    // empty, directly under the box that had just committed.
    expect(await screen.findByText(/the first one -- Test/)).toBeInTheDocument();
  });

  it('will not commit without a message or without anything staged', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ unstaged: [{ path: 'b.txt', staged: '', worktree: 'M' }] })
    );
    render(<GitPanel hidden={false} />);

    const commit = await screen.findByRole('button', { name: /^Commit/ });
    expect(commit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Commit message'), {
      target: { value: 'a message with nothing behind it' },
    });
    // Still nothing staged, so still nothing to commit.
    expect(commit).toBeDisabled();
    expect(commitStaged).not.toHaveBeenCalled();
  });

  it('offers a push only when there is somewhere to push to', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ staged: [{ path: 'a.txt', staged: 'A', worktree: '' }] })
    );
    const { rerender } = render(<GitPanel hidden={false} />);

    expect(await screen.findByRole('button', { name: /^Commit/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commit & Push' })).not.toBeInTheDocument();

    getGitStatus.mockResolvedValue(
      aStatus({
        staged: [{ path: 'a.txt', staged: 'A', worktree: '' }],
        hasRemote: true,
        upstream: 'origin/main',
        ahead: 1,
      })
    );
    rerender(<GitPanel hidden />);
    rerender(<GitPanel hidden={false} />);

    const push = await screen.findByRole('button', { name: 'Commit & Push' });
    fireEvent.change(screen.getByPlaceholderText('Commit message'), {
      target: { value: 'off it goes' },
    });
    fireEvent.click(push);

    await waitFor(() => expect(commitStaged).toHaveBeenCalledWith('off it goes', { push: true }));
  });

  it('blocks a commit while a merge is unresolved', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({
        staged: [{ path: 'a.txt', staged: 'M', worktree: '' }],
        conflicted: [{ path: 'notes.txt', staged: 'U', worktree: 'U' }],
      })
    );
    render(<GitPanel hidden={false} />);

    expect(await screen.findByText('Merge conflicts')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Commit message'), {
      target: { value: 'committing the conflict markers' },
    });
    expect(screen.getByRole('button', { name: /^Commit/ })).toBeDisabled();
  });

  it('lists branches only once the menu is asked for, and switches to the one clicked', async () => {
    render(<GitPanel hidden={false} />);
    await waitFor(() => expect(getGitStatus).toHaveBeenCalled());
    // A repository can have hundreds of remote-tracking refs and the panel draws none of them, so the
    // list is not part of the status it reads on every change.
    expect(getBranches).not.toHaveBeenCalled();

    await openBranchMenu();
    // The one that is checked out is shown and not offered: switching to it does nothing.
    expect(screen.getByRole('menuitem', { name: /main/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /origin\/theirs/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: /topic/ }));
    await waitFor(() => expect(checkoutBranch).toHaveBeenCalledWith('topic'));

    // Done, so the menu goes: leaving it open over a panel that has just redrawn itself for another
    // branch is a list of somewhere else.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Find or create a branch')).not.toBeInTheDocument()
    );
  });

  it('creates a branch named by what was typed to look for one', async () => {
    render(<GitPanel hidden={false} />);
    await openBranchMenu();

    const filter = screen.getByPlaceholderText('Find or create a branch');
    fireEvent.change(filter, { target: { value: 'topic' } });
    // An existing name is a name to switch to, so there is nothing to create.
    expect(screen.queryByText(/^Create branch/)).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'spec/new-thing' } });
    fireEvent.click(screen.getByRole('menuitem', { name: /Create branch spec\/new-thing/ }));

    await waitFor(() =>
      expect(checkoutBranch).toHaveBeenCalledWith('spec/new-thing', { create: true })
    );
  });

  it('asks before deleting a branch, and offers no delete for the current one', async () => {
    render(<GitPanel hidden={false} />);
    await openBranchMenu();

    // git refuses both of these, so neither is drawn: the branch that is checked out, and a ref that
    // belongs to the remote.
    expect(screen.queryByLabelText('Delete main')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete origin/theirs')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Delete topic'));
    expect(await screen.findByText('Delete branch')).toBeInTheDocument();
    expect(deleteBranch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // Unforced, so a branch whose commits are nowhere else is still git's to refuse.
    await waitFor(() => expect(deleteBranch).toHaveBeenCalledWith('topic', false));
  });

  it('fetches, pulls and pushes, and counts what each is about', async () => {
    const behind = aStatus({ hasRemote: true, upstream: 'origin/main', ahead: 1, behind: 2 });
    getGitStatus.mockResolvedValue(behind);
    // The panel redraws from whatever each write answers with, and a status with no remote takes these
    // buttons away — so all three have to still be there to press after the first one.
    fetchRemote.mockResolvedValue(behind);
    pullRemote.mockResolvedValue(behind);
    pushRemote.mockResolvedValue(behind);
    render(<GitPanel hidden={false} />);

    const pull = await screen.findByLabelText('Pull');
    const push = screen.getByLabelText('Push');
    // The counts are the buttons' labels rather than text beside the branch name, which said how far
    // behind the branch was and gave no way to do anything about it.
    expect(pull).toHaveTextContent('2');
    expect(push).toHaveTextContent('1');

    fireEvent.click(screen.getByLabelText('Fetch'));
    await waitFor(() => expect(fetchRemote).toHaveBeenCalled());

    fireEvent.click(pull);
    await waitFor(() => expect(pullRemote).toHaveBeenCalled());

    fireEvent.click(push);
    await waitFor(() => expect(pushRemote).toHaveBeenCalled());
  });

  it('offers nothing to sync with when there is no remote', async () => {
    render(<GitPanel hidden={false} />);

    expect(await screen.findByLabelText('Branch: main')).toBeInTheDocument();
    // All three would be refused by the server, which is a worse way to find out.
    expect(screen.queryByLabelText('Fetch')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pull')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Push')).not.toBeInTheDocument();
  });

  it('re-reads on demand', async () => {
    render(<GitPanel hidden={false} />);
    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(2));
  });
});
