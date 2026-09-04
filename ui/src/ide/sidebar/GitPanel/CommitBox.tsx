import { GitStatus } from '@/api';
import { ICommitAction } from './useCommitAction';

interface CommitBoxProps {
  status: GitStatus;
  busy: boolean;
  action: ICommitAction;
}

/**
 * The commit message and the two ways to use it.
 *
 * There are deliberately no per-file checkboxes. The previous panel had them and they did not mean
 * anything: it ticked files, added them, and then committed with go-git's `All: true`, so every modified
 * file in the repository went in. What is committed is what is staged, and the sections above are where
 * that is decided.
 */
export default function CommitBox({ status, busy, action }: CommitBoxProps) {
  const { message, setMessage, ready, reason, commit, box } = action;

  return (
    <div className="commit-box">
      <textarea
        ref={box}
        className="gitpanel-input commit-message-input"
        value={message}
        rows={3}
        placeholder="Commit message"
        disabled={busy}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          // The shortcut every other commit box has, and the only way to commit without leaving the
          // keyboard: Enter itself has to stay a newline, since a message has a body.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void commit(false);
          }
        }}
      />

      <div className="commit-actions">
        <button
          type="button"
          className="z-button"
          disabled={!ready}
          title={reason}
          onClick={() => void commit(false)}
        >
          Commit
        </button>
        {status.hasRemote && (
          <button
            type="button"
            className="z-button z-button-secondary"
            disabled={!ready}
            title={reason}
            onClick={() => void commit(true)}
          >
            Commit &amp; Push
          </button>
        )}
      </div>
    </div>
  );
}
