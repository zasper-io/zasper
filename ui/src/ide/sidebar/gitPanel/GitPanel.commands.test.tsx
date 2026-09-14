import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from 'react-toastify';

import {
  commitStaged,
  fetchRemote,
  getBranches,
  getGitStatus,
  pullRemote,
  pushRemote,
  stageFiles,
} from './gitPanelFakes';
import { aStatus, reveal, setUpGitPanel, withPalette } from './gitPanelTestKit';

vi.mock('@/api', async () => (await import('./gitPanelFakes')).apiModule());
vi.mock('react-toastify', async () => (await import('./gitPanelFakes')).toastModule());

beforeEach(setUpGitPanel);

describe('the git commands', () => {
  /** One file of each kind, so what a command leaves alone is as visible as what it takes. */
  const dirty = aStatus({
    staged: [{ path: 'staged.txt', staged: 'M', worktree: '' }],
    unstaged: [{ path: 'src/changed.txt', staged: '', worktree: 'M' }],
    untracked: [{ path: 'new.txt', staged: '', worktree: '?' }],
    conflicted: [{ path: 'clash.txt', staged: 'U', worktree: 'U' }],
  });

  it('are all in the palette', async () => {
    withPalette();

    const labels: Record<string, string> = {
      'git:stage-all': 'Stage All Changes',
      'git:commit': 'Commit',
      'git:fetch': 'Fetch',
      'git:pull': 'Pull',
      'git:push': 'Push',
      'git:checkout-branch': 'Checkout Branch…',
    };
    for (const [id, label] of Object.entries(labels)) {
      expect(await screen.findByTestId(id)).toHaveTextContent(label);
    }
  });

  it('are there before anyone has opened the panel, and quiet until used', async () => {
    withPalette(true);

    expect(await screen.findByTestId('git:stage-all')).toBeInTheDocument();
    // Registering them must not be what makes a hidden panel talk to the server: for someone who works
    // from the palette the sidebar may never be opened at all.
    expect(getGitStatus).not.toHaveBeenCalled();
  });

  it('stage everything git could be told about, except the conflicts', async () => {
    getGitStatus.mockResolvedValue(dirty);
    withPalette(true);

    fireEvent.click(await screen.findByTestId('git:stage-all'));

    // Read when asked, not taken from the panel: the panel was never open, so it holds nothing — and a
    // list it did hold could be from before a commit made in a terminal.
    await waitFor(() => expect(stageFiles).toHaveBeenCalledWith(['src/changed.txt', 'new.txt']));
    // Staging a conflicted file is how git is told it has been resolved, and this one still has the
    // markers in it.
    expect(stageFiles).not.toHaveBeenCalledWith(expect.arrayContaining(['clash.txt']));
  });

  it('say when there is nothing to stage instead of staging nothing', async () => {
    withPalette();

    fireEvent.click(await screen.findByTestId('git:stage-all'));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Nothing to stage.'));
    expect(stageFiles).not.toHaveBeenCalled();
  });

  it('commit the message the box holds', async () => {
    getGitStatus.mockResolvedValue(
      aStatus({ staged: [{ path: 'a.txt', staged: 'A', worktree: '' }] })
    );
    withPalette();

    fireEvent.change(await screen.findByPlaceholderText('Commit message'), {
      target: { value: 'from the palette' },
    });
    fireEvent.click(screen.getByTestId('git:commit'));

    // The same commit the button makes, because it is the same action behind both.
    await waitFor(() =>
      expect(commitStaged).toHaveBeenCalledWith('from the palette', { push: false })
    );
  });

  it('show the panel rather than commit nothing', async () => {
    getGitStatus.mockResolvedValue(dirty);
    withPalette();
    await screen.findByPlaceholderText('Commit message');

    fireEvent.click(screen.getByTestId('git:commit'));

    // Nothing is written and there is a conflict besides. Why is on the panel — the disabled button's
    // reason, the conflicts section — so the panel is the answer, with the caret in the box.
    expect(commitStaged).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByPlaceholderText('Commit message')).toHaveFocus());
  });

  it('fetch, pull and push', async () => {
    withPalette();

    fireEvent.click(await screen.findByTestId('git:fetch'));
    await waitFor(() => expect(fetchRemote).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('git:pull'));
    await waitFor(() => expect(pullRemote).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('git:push'));
    await waitFor(() => expect(pushRemote).toHaveBeenCalled());
  });

  it('open the branch menu on the panel', async () => {
    withPalette();
    await screen.findByLabelText('Branch: main');

    fireEvent.click(screen.getByTestId('git:checkout-branch'));

    // Which is a menu that reads its own branches and takes the typing, so opening it is the whole
    // command: there is no second palette for the branch names.
    expect(reveal).toHaveBeenCalled();
    expect(await screen.findByLabelText('Find or create a branch')).toBeInTheDocument();
    await waitFor(() => expect(getBranches).toHaveBeenCalled());
  });
});
