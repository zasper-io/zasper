import { RefObject, useRef, useState } from 'react';

import { commitStaged, GitStatus } from '@/api';
import { IGitStatus } from './useGitStatus';

export interface ICommitAction {
  message: string;
  setMessage: (message: string) => void;
  /** Whether a commit would be accepted now. */
  ready: boolean;
  /** Why it would not be, undefined when it would. */
  reason?: string;
  commit: (push: boolean) => Promise<void>;
  /**
   * The message box, so something outside it can put the caret there — a palette command asked to
   * commit with nothing written yet has nowhere else useful to go.
   */
  box: RefObject<HTMLTextAreaElement | null>;
}

/**
 * The message, and what may be done with it.
 *
 * A hook rather than state inside `CommitBox` because the command palette can ask for a commit too, and
 * a second implementation of "is this allowed, and what does it send" would be a second answer.
 */
export function useCommitAction(
  status: GitStatus,
  busy: boolean,
  run: IGitStatus['run']
): ICommitAction {
  const [message, setMessage] = useState<string>('');
  const box = useRef<HTMLTextAreaElement>(null);

  const staged = status.staged.length;
  const conflicted = status.conflicted.length;
  const ready = message.trim() !== '' && staged > 0 && conflicted === 0 && !busy;

  const reason = (): string | undefined => {
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

  return { message, setMessage, ready, reason: reason(), commit, box };
}
