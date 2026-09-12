import { fetchRemote, GitStatus, pullRemote, pushRemote } from '@/api';
import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { IGitStatus } from './useGitStatus';

interface SyncActionsProps {
  status: GitStatus;
  busy: boolean;
  run: IGitStatus['run'];
}

/**
 * Fetch, pull and push, with the counts they are about.
 *
 * The counts used to be text beside the branch name, which said how far behind the branch was and gave no
 * way to do anything about it. They are the labels of the buttons instead: the number on the arrow down is
 * what a pull would bring, and the one on the arrow up is what a push would send.
 *
 * Nothing here is offered without a remote, since all three would be refused.
 */
export default function SyncActions({ status, busy, run }: SyncActionsProps) {
  if (!status.hasRemote) {
    return null;
  }

  const disabled = busy || !status.gitAvailable;
  // Said plainly on every tooltip, because a branch with no upstream is the case where pull has nothing
  // to go on and push has to invent one.
  const tracking = status.upstream === '' ? 'no upstream branch' : status.upstream;

  return (
    <div className="git-sync-actions">
      <IconButton
        icon="cloud-download"
        className="git-sync-action"
        label={`Fetch from the remote (${tracking})`}
        name="Fetch"
        disabled={disabled}
        onClick={() => void run(fetchRemote)}
      />

      <IconButton
        icon="arrow-down"
        className="git-sync-action"
        label={`Pull ${status.behind} commits from ${tracking}`}
        name="Pull"
        disabled={disabled}
        onClick={() => void run(pullRemote, 'Pulled.')}
      >
        {status.behind > 0 && <span className="git-sync-count">{status.behind}</span>}
      </IconButton>

      <IconButton
        icon="arrow-up"
        className="git-sync-action"
        label={`Push ${status.ahead} commits to ${tracking}`}
        name="Push"
        disabled={disabled}
        onClick={() => void run(pushRemote, 'Pushed.')}
      >
        {status.ahead > 0 && <span className="git-sync-count">{status.ahead}</span>}
      </IconButton>
    </div>
  );
}
