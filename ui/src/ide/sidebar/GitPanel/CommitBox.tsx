import { useState } from 'react';

import { commitStaged, GitStatus } from '@/api';
import { IGitStatus } from './useGitStatus';

interface CommitBoxProps {
  status: GitStatus;
  busy: boolean;
  run: IGitStatus['run'];
}

/**
 * The commit message and the two ways to use it.
 *
 * There are deliberately no per-file checkboxes. The previous panel had them and they did not mean
 * anything: it ticked files, added them, and then committed with go-git's `All: true`, so every modified
 * file in the repository went in. What is committed is what is staged, and the sections above are where
 * that is decided.
 */
export default function CommitBox({ status, busy, run }: CommitBoxProps) {
  const [message, setMessage] = useState<string>('');

  const staged = status.staged.length;
  const conflicted = status.conflicted.length;
  const ready = message.trim() !== '' && staged > 0 && conflicted === 0 && !busy;

  const commit = async (push: boolean) => {
    if (!ready) {
      return;
    }
    const done = await run(
      () => commitStaged(message, { push }),
      push ? 'Committed and pushed.' : 'Committed.'
    );
    // Only on success: a commit refused for a missing identity or a failing hook is one the message
    // still has to survive.
    if (done) {
      setMessage('');
    }
  };

  const why = (): string | undefined => {
    if (conflicted > 0) {
      return 'Resolve the merge conflicts first';
    }
    if (staged === 0) {
      return 'Nothing is staged';
    }
    if (message.trim() === '') {
      return 'Write a commit message';
    }
    return undefined;
  };

  return (
    <div className="commit-box">
      <textarea
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
          title={why()}
          onClick={() => void commit(false)}
        >
          Commit
        </button>
        {status.hasRemote && (
          <button
            type="button"
            className="z-button z-button-secondary"
            disabled={!ready}
            title={why()}
            onClick={() => void commit(true)}
          >
            Commit &amp; Push
          </button>
        )}
      </div>
    </div>
  );
}
