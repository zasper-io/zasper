import { useCallback, useState } from 'react';

import './GitPanel.scss';

import { discardFiles, initRepository, stageFiles, unstageFiles } from '@/api';
import BranchMenu from './BranchMenu';
import ChangeList, { IChangeAction } from './ChangeList';
import CommitBox from './CommitBox';
import ConfirmDiscardDialog from './ConfirmDiscardDialog';
import History from './History';
import SyncActions from './SyncActions';
import { PanelProps } from '../types';
import { IGitStatus, useGitStatus } from './useGitStatus';

export default function GitPanel({ hidden }: PanelProps) {
  const { status, loading, busy, error, refresh, run } = useGitStatus(hidden);
  // The paths a discard has been asked for and not yet confirmed.
  const [pending, setPending] = useState<string[] | null>(null);
  const [historyKey, setHistoryKey] = useState<number>(0);
  const [branchMenu, setBranchMenu] = useState<boolean>(false);

  const disabled = busy || !status.gitAvailable;

  // Staging and discarding cannot change what the history shows. Committing, pulling and switching
  // branch all can, and the History below has to show what happened rather than what it read last time.
  const changesHistory: IGitStatus['run'] = useCallback(
    async (action, success) => {
      const worked = await run(action, success);
      if (worked) {
        setHistoryKey((key) => key + 1);
      }
      return worked;
    },
    [run]
  );

  const stage: IChangeAction = {
    label: 'Stage',
    icon: 'fas fa-plus',
    run: (paths) => void run(() => stageFiles(paths)),
  };
  const unstage: IChangeAction = {
    label: 'Unstage',
    icon: 'fas fa-minus',
    run: (paths) => void run(() => unstageFiles(paths)),
  };
  const discard: IChangeAction = {
    label: 'Discard',
    icon: 'fas fa-undo',
    run: (paths) => setPending(paths),
  };

  // Which of the pending paths git has never seen, since discarding one of those is a delete and the
  // server refuses it unless asked twice.
  const untracked = new Set(status.untracked.map((change) => change.path));
  const pendingUntracked = (pending ?? []).filter((path) => untracked.has(path));
  const pendingTracked = (pending ?? []).filter((path) => !untracked.has(path));

  const confirmDiscard = async () => {
    const paths = pending ?? [];
    setPending(null);
    await run(() => discardFiles(paths, pendingUntracked.length > 0), 'Discarded.');
  };

  const nothingToDo =
    status.staged.length === 0 &&
    status.unstaged.length === 0 &&
    status.untracked.length === 0 &&
    status.conflicted.length === 0;

  return (
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <div className="z-label">Source control</div>
        <div className="git-head-actions">
          <button
            className="editor-button"
            title="Refresh"
            onClick={() => {
              refresh();
              setHistoryKey((key) => key + 1);
            }}
          >
            <i className="fas fa-sync"></i>
          </button>
        </div>
      </div>

      {/* Above the scroll area, as the file browser's banner and error are: which branch this is and
          why the last read failed are about the whole panel, not the top of it. */}
      {status.isRepository && (
        <div className="git-branch-bar">
          {/* The branch name is the button, as it is in every other editor's status bar: what someone
              wants when they look at which branch they are on is usually another branch. */}
          <div className="git-branch-picker">
            <button
              type="button"
              className="git-branch"
              title={status.upstream === '' ? 'No upstream branch' : `Tracking ${status.upstream}`}
              aria-label={`Branch: ${status.branch}`}
              aria-expanded={branchMenu}
              disabled={disabled}
              onClick={() => setBranchMenu((open) => !open)}
            >
              <i className="fas fa-code-branch"></i> {status.branch}
            </button>
            {branchMenu && (
              <BranchMenu
                status={status}
                busy={busy}
                run={changesHistory}
                onClose={() => setBranchMenu(false)}
              />
            )}
          </div>
          <SyncActions status={status} busy={busy} run={changesHistory} />
        </div>
      )}

      {error !== '' && (
        <div className="panel-error">
          <p>{error}</p>
        </div>
      )}

      {status.isRepository && !status.gitAvailable && (
        <div className="panel-error">
          <p>No git binary was found, so changes can be listed but not changed.</p>
        </div>
      )}

      {/* One scroll area for the whole panel, not one per section. */}
      <div className="content-inner">
        {/* Nothing below can work without a repository, and "No changes" over a commit form is the
            wrong thing to say about a project that is not under git at all. */}
        {!loading && !status.isRepository && (
          <div className="panel-section-body git-init">
            <p>This project is not a git repository.</p>
            {status.gitAvailable ? (
              // The whole of `git init` from here, since the alternative for someone in a browser is a
              // terminal. What the first branch is called is the machine's answer and not this panel's,
              // which is why the server runs git rather than creating the repository itself.
              <button
                type="button"
                className="z-button"
                disabled={busy}
                onClick={() => void changesHistory(initRepository, 'Created an empty repository.')}
              >
                Initialise repository
              </button>
            ) : (
              <p>No git binary was found, so one cannot be created from here.</p>
            )}
          </div>
        )}

        {status.isRepository && (
          <>
            <CommitBox status={status} busy={busy} run={changesHistory} />

            {/* Conflicts first: they are the only thing here that blocks a commit. Staging one is how
                git is told it has been resolved, so that is the action offered. */}
            <ChangeList
              title="Merge conflicts"
              changes={status.conflicted}
              side="staged"
              disabled={disabled}
              actions={[stage]}
            />
            <ChangeList
              title="Staged"
              changes={status.staged}
              side="staged"
              disabled={disabled}
              actions={[unstage]}
            />
            <ChangeList
              title="Changes"
              changes={status.unstaged}
              side="worktree"
              disabled={disabled}
              actions={[discard, stage]}
            />
            <ChangeList
              title="Untracked"
              changes={status.untracked}
              side="worktree"
              disabled={disabled}
              actions={[discard, stage]}
            />

            {!loading && nothingToDo && (
              <div className="panel-section-body">
                <p>No changes.</p>
              </div>
            )}
          </>
        )}

        <h2 className="z-subheading panel-section-head">History</h2>
        <div className="panel-section-body">
          <History hidden={hidden} reloadKey={historyKey} />
        </div>
      </div>

      {pending !== null && (
        <ConfirmDiscardDialog
          tracked={pendingTracked}
          untracked={pendingUntracked}
          discarding={busy}
          onConfirm={() => void confirmDiscard()}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
