import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GitPanel from './GitPanel';
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
import {
  aCommit,
  aPage,
  aStatus,
  empty,
  openBranchMenu,
  setUpGitPanel,
  ThePanel,
  withTabs,
} from './gitPanelTestKit';

vi.mock('@/api', async () => (await import('./gitPanelFakes')).apiModule());
vi.mock('react-toastify', async () => (await import('./gitPanelFakes')).toastModule());

beforeEach(setUpGitPanel);

describe('GitPanel', () => {
  it('asks the server for nothing while it is hidden', async () => {
    render(<ThePanel hidden />);

    // Every sidebar panel stays mounted, so an unguarded fetch here is a request on every boot for a
    // panel nobody opened.
    await waitFor(() => expect(screen.getByText('Source control')).toBeInTheDocument());
    expect(getGitStatus).not.toHaveBeenCalled();
    expect(getLog).not.toHaveBeenCalled();
  });

  it('fetches when it is opened', async () => {
    const { rerender } = render(<ThePanel hidden />);
    rerender(<ThePanel hidden={false} />);

    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(1));
    expect(getLog).toHaveBeenCalledTimes(1);
  });

  it('says a project is not a repository rather than that it has nothing to commit', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ isRepository: false, gitAvailable: true, branch: '' })
    );
    getLog.mockResolvedValue({ commits: [], hasMore: false, isRepository: false });
    render(<ThePanel hidden={false} />);

    expect(await screen.findByText('This project is not a git repository.')).toBeInTheDocument();
    // Nothing on it could work, so the commit form is not offered.
    expect(screen.queryByPlaceholderText('Commit message')).not.toBeInTheDocument();
    expect(screen.queryByText('No changes.')).not.toBeInTheDocument();
    expect(await screen.findByText('No history.')).toBeInTheDocument();
  });

  it('shows an empty repository as a repository with no changes', async () => {
    render(<ThePanel hidden={false} />);

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
    getLog.mockResolvedValue(aPage([aCommit]));
    render(<ThePanel hidden={false} />);

    expect(await screen.findByText('Staged')).toBeInTheDocument();
    expect(screen.getByText('Changes')).toBeInTheDocument();
    expect(screen.getByText('Untracked')).toBeInTheDocument();
    // One path, two sections, because the two halves of the index disagree: a staged file that is not
    // further modified still belongs in both.
    expect(screen.getByLabelText('Unstage src/notes.txt')).toBeInTheDocument();
    expect(screen.getByLabelText('Stage src/notes.txt')).toBeInTheDocument();
    // The name is the file, the folder is beside it: two sections mentioning src/notes.txt is exactly
    // the case where the bare name would not be enough.
    expect(screen.getAllByText('notes.txt')).toHaveLength(2);
    expect(screen.getAllByText('src')).toHaveLength(2);
    expect(await screen.findByText('the first one')).toBeInTheDocument();
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
    render(<ThePanel hidden={false} />);

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
    render(<ThePanel hidden={false} />);

    fireEvent.click(await screen.findByLabelText('Stage all'));
    await waitFor(() => expect(stageFiles).toHaveBeenCalledWith(['a.txt', 'b.txt']));
  });

  it('asks before discarding, and says an untracked file will be deleted', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ untracked: [{ path: 'scratch.txt', staged: '?', worktree: '?' }] })
    );
    render(<ThePanel hidden={false} />);

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
    render(<ThePanel hidden={false} />);

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
    render(<ThePanel hidden={false} />);

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
    render(<ThePanel hidden={false} />);
    await waitFor(() => expect(getLog).toHaveBeenCalledTimes(1));

    getLog.mockResolvedValue(aPage([aCommit]));
    fireEvent.change(await screen.findByPlaceholderText('Commit message'), {
      target: { value: 'the first one' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Commit/ }));

    // The history is its own read, so without this it stayed as it was when the panel was opened —
    // empty, directly under the box that had just committed.
    expect(await screen.findByText('the first one')).toBeInTheDocument();
  });

  it('will not commit without a message or without anything staged', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ unstaged: [{ path: 'b.txt', staged: '', worktree: 'M' }] })
    );
    render(<ThePanel hidden={false} />);

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
    const { rerender } = render(<ThePanel hidden={false} />);

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
    rerender(<ThePanel hidden />);
    rerender(<ThePanel hidden={false} />);

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
    render(<ThePanel hidden={false} />);

    expect(await screen.findByText('Merge conflicts')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Commit message'), {
      target: { value: 'committing the conflict markers' },
    });
    expect(screen.getByRole('button', { name: /^Commit/ })).toBeDisabled();
  });

  it('lists branches only once the menu is asked for, and switches to the one clicked', async () => {
    render(<ThePanel hidden={false} />);
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
    render(<ThePanel hidden={false} />);
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
    render(<ThePanel hidden={false} />);
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
    render(<ThePanel hidden={false} />);

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
    render(<ThePanel hidden={false} />);

    expect(await screen.findByLabelText('Branch: main')).toBeInTheDocument();
    // All three would be refused by the server, which is a worse way to find out.
    expect(screen.queryByLabelText('Fetch')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pull')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Push')).not.toBeInTheDocument();
  });

  it('tells one commit from another, which the old list could not', async () => {
    // Against the real clock rather than a fixed date, so the wording does not go stale: two hours ago
    // is two hours ago whenever this runs.
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    getLog.mockResolvedValue(
      aPage([
        { ...aCommit, date: twoHoursAgo },
        { ...aCommit, hash: 'f00', shortHash: 'f00', subject: 'a merge', parents: ['a', 'b'] },
      ])
    );
    render(<ThePanel hidden={false} />);

    // The three things that tell two commits apart: without them, a repository with two commits called
    // "wip" is two identical rows.
    expect(await screen.findByText('abc1234')).toBeInTheDocument();
    expect(screen.getByText('2 hours ago')).toBeInTheDocument();
    expect(screen.getAllByText('Test')).toHaveLength(2);
    // The one row in a list with no lanes whose diff is against one parent of two.
    expect(screen.getByText('merge')).toBeInTheDocument();
  });

  it('asks for another page only when the server said there is one', async () => {
    getLog.mockResolvedValue(aPage([aCommit], true));
    render(<ThePanel hidden={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));

    // Skipping what is already on screen: go-git's log has no offset, so the page after the first is
    // the server walking past it.
    await waitFor(() => expect(getLog).toHaveBeenCalledWith({ limit: 30, skip: 1 }));

    getLog.mockResolvedValue(aPage([aCommit]));
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    // Gone, because the server said so. Deciding from a full page instead would leave a history whose
    // length is a multiple of the page size ending in a button with nothing behind it.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
    );
  });

  it('opens a commit onto the files in it', async () => {
    getLog.mockResolvedValue(aPage([aCommit]));
    render(<ThePanel hidden={false} />);

    // Not read with the page: thirty rows would be thirty diffs against thirty parents, for something
    // almost none of them are asked about.
    expect(getCommitDetail).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByText('the first one'));
    await waitFor(() => expect(getCommitDetail).toHaveBeenCalledWith('abc1234def5678'));

    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();
    // git counts no lines in a PNG, so saying "+0 −0" would report it as changed by nothing.
    expect(screen.getByText('binary')).toBeInTheDocument();
    // The rest of the message, which the row itself shows only the first line of.
    expect(screen.getByText('and more said about it underneath')).toBeInTheDocument();
  });

  /*
   * Which comparison a row opens is decided by the section it is in.
   *
   * A file staged and then edited again is in two sections, and they are two different pairs of
   * documents: what a commit would record, and what it would leave behind. A row opening the wrong one
   * shows a plausible diff of the wrong thing.
   */
  it('opens the comparison the section is about', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({
        staged: [{ path: 'src/notes.txt', staged: 'M', worktree: 'M' }],
        unstaged: [{ path: 'src/notes.txt', staged: 'M', worktree: 'M' }],
      })
    );
    withTabs(<ThePanel hidden={false} />);

    // Staged first, in the order the sections are drawn in.
    const rows = await screen.findAllByText('notes.txt');
    fireEvent.click(rows[0]);
    expect(screen.getByTestId('diffs')).toHaveTextContent(
      'diff:staged:src/notes.txt {"path":"src/notes.txt","staged":true}'
    );

    fireEvent.click(rows[1]);
    // Two tabs, not one reopened: the same file compared two ways is two things to look at.
    expect(screen.getByTestId('diffs')).toHaveTextContent(
      'diff:worktree:src/notes.txt {"path":"src/notes.txt"}'
    );
  });

  it('opens a file of a commit against that commit', async () => {
    getLog.mockResolvedValue(aPage([aCommit]));
    withTabs(<ThePanel hidden={false} />);

    fireEvent.click(await screen.findByText('the first one'));
    fireEvent.click(await screen.findByText('notes.txt'));

    // The commit, not the working tree: what a file listed under a commit means is what that commit did
    // to it.
    expect(screen.getByTestId('diffs')).toHaveTextContent(
      'diff:abc1234def5678:src/notes.txt {"path":"src/notes.txt","ref":"abc1234def5678"}'
    );
  });

  it('offers to make a plain folder a repository', async () => {
    const plain = aStatus({ isRepository: false, gitAvailable: true, branch: '' });
    getGitStatus.mockResolvedValue(plain);
    getLog.mockResolvedValue({ commits: [], hasMore: false, isRepository: false });
    initRepository.mockResolvedValue(aStatus({ branch: 'main' }));
    render(<ThePanel hidden={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Initialise' }));
    await waitFor(() => expect(initRepository).toHaveBeenCalled());

    // The panel is now a panel over a repository, drawn from what the write answered with rather than
    // from a status read chasing it.
    expect(await screen.findByLabelText('Branch: main')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Commit message')).toBeInTheDocument();
  });

  it('does not offer to make a repository with no git to make one with', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ isRepository: false, gitAvailable: false, branch: '' })
    );
    render(<ThePanel hidden={false} />);

    // One sentence rather than two, because the band is one line of message with the action pinned
    // to its right, and there is no action here — so the reason is mid-sentence and lower case.
    expect(
      await screen.findByText(/This project is not a git repository, and no git binary was found/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Initialise' })).not.toBeInTheDocument();
  });

  it('re-reads on demand', async () => {
    render(<ThePanel hidden={false} />);
    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Refresh'));
    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(2));
  });
});
