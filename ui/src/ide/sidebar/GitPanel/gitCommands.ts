import { toast } from 'react-toastify';

import {
  apiErrorMessage,
  fetchRemote,
  getGitStatus,
  GitStatus,
  pullRemote,
  pushRemote,
  stageFiles,
} from '@/api';
import { ICommand } from '@/commands/types';
import { ICommitAction } from './useCommitAction';
import { IGitStatus } from './useGitStatus';

/** What the panel lends its commands: its one way of writing, and its two ways of being looked at. */
export interface IGitCommandTargets {
  busy: boolean;
  run: IGitStatus['run'];
  commit: ICommitAction;
  /** Brings the panel into view. A command whose answer is on the panel has to put it on screen. */
  reveal: () => void;
  openBranchMenu: () => void;
}

/** Everything in the working tree git could be told about, which is not the same as everything it has. */
function stageable(status: GitStatus): string[] {
  // Conflicts are left out on purpose. Staging a conflicted file is how git is told it has been
  // resolved, and doing that to a file still full of `<<<<<<<` markers commits them.
  return [...status.unstaged, ...status.untracked].map((change) => change.path);
}

/**
 * The palette's git entries.
 *
 * Enabled without a status to check them against, unlike the panel's own buttons. Every sidebar panel
 * stays mounted but only reads while it is open, so a command that insisted on a fresh status would be
 * dead in every session where nobody happened to look at source control. What cannot be done is refused
 * by the server in its own words instead — "Please tell me who you are", "does not appear to be a git
 * repository" — which is what the panel shows for a failed write anyway.
 *
 * Not memoized, as the notebook's commands are not: the bodies close over this render's state, and
 * `useRegisterCommands` re-registers only when the set of ids changes.
 */
export function useGitCommands(targets: IGitCommandTargets): ICommand[] {
  const { busy, run, commit } = targets;

  const gitCommand = (command: Omit<ICommand, 'category' | 'scope' | 'isEnabled'>): ICommand => ({
    category: 'Git',
    scope: 'app',
    // One write at a time, which is the same rule the panel's buttons follow: the server takes the
    // index lock for each of these.
    isEnabled: () => !busy,
    ...command,
  });

  return [
    gitCommand({
      id: 'git:stage-all',
      label: 'Stage All Changes',
      description: 'Stage every change and every untracked file',
      execute: () => {
        void (async () => {
          // Read first rather than trusting what the panel last saw. It may have seen nothing at all,
          // and staging a list from before a commit somewhere else would stage the wrong files.
          let paths: string[];
          try {
            paths = stageable(await getGitStatus());
          } catch (failure) {
            toast.error(apiErrorMessage(failure));
            return;
          }
          if (paths.length === 0) {
            toast.info('Nothing to stage.');
            return;
          }
          await run(
            () => stageFiles(paths),
            `Staged ${paths.length} ${paths.length === 1 ? 'file' : 'files'}.`
          );
        })();
      },
    }),

    gitCommand({
      id: 'git:commit',
      label: 'Commit',
      description: 'Commit what is staged',
      execute: () => {
        if (commit.ready) {
          void commit.commit(false);
          return;
        }
        // Whatever is missing — a message, something staged, a conflict resolved — is on the panel, so
        // the panel is the answer. The caret goes in the box, which is where it is missing from most
        // often.
        targets.reveal();
        requestAnimationFrame(() => commit.box.current?.focus());
      },
    }),

    gitCommand({
      id: 'git:fetch',
      label: 'Fetch',
      description: 'Fetch from the remote without changing the working tree',
      execute: () => void run(fetchRemote, 'Fetched.'),
    }),

    gitCommand({
      id: 'git:pull',
      label: 'Pull',
      description: 'Pull the tracking branch',
      execute: () => void run(pullRemote, 'Pulled.'),
    }),

    gitCommand({
      id: 'git:push',
      label: 'Push',
      description: 'Push to the tracking branch',
      execute: () => void run(pushRemote, 'Pushed.'),
    }),

    gitCommand({
      id: 'git:checkout-branch',
      label: 'Checkout Branch…',
      description: 'Switch to another branch, or create one',
      // The menu reads the branches itself and takes focus to its filter, so this is the whole command.
      execute: () => {
        targets.reveal();
        targets.openBranchMenu();
      },
    }),
  ];
}
