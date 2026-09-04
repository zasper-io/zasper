import { fetchRemote, GitStatus, pullRemote, pushRemote } from '@/api';
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
      <button
        type="button"
        className="editor-button git-sync-action"
        title={`Fetch from the remote (${tracking})`}
        aria-label="Fetch"
        disabled={disabled}
        onClick={() => void run(fetchRemote)}
      >
        <i className="fas fa-cloud-download-alt"></i>
      </button>

      <button
        type="button"
        className="editor-button git-sync-action"
        title={`Pull ${status.behind} commits from ${tracking}`}
        aria-label="Pull"
        disabled={disabled}
        onClick={() => void run(pullRemote, 'Pulled.')}
      >
        <i className="fas fa-arrow-down"></i>
        {status.behind > 0 && <span className="git-sync-count">{status.behind}</span>}
      </button>

      <button
        type="button"
        className="editor-button git-sync-action"
        title={`Push ${status.ahead} commits to ${tracking}`}
        aria-label="Push"
        disabled={disabled}
        onClick={() => void run(pushRemote, 'Pushed.')}
      >
        <i className="fas fa-arrow-up"></i>
        {status.ahead > 0 && <span className="git-sync-count">{status.ahead}</span>}
      </button>
    </div>
  );
}
