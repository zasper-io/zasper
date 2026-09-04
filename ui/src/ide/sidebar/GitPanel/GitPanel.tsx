import { useCallback, useState } from 'react';

import './GitPanel.scss';

import { discardFiles, stageFiles, unstageFiles } from '@/api';
import ChangeList, { IChangeAction } from './ChangeList';
import CommitBox from './CommitBox';
import ConfirmDiscardDialog from './ConfirmDiscardDialog';
import { CommitGraphContainer } from './CommitGraphContainer';
import { PanelProps } from '../types';
import { IGitStatus, useGitStatus } from './useGitStatus';

export default function GitPanel({ hidden }: PanelProps) {
  const { status, loading, busy, error, refresh, run } = useGitStatus(hidden);
  // The paths a discard has been asked for and not yet confirmed.
  const [pending, setPending] = useState<string[] | null>(null);
  const [historyKey, setHistoryKey] = useState<number>(0);

  const disabled = busy || !status.gitAvailable;

  // Staging and discarding cannot add a commit; committing can, and the History below has to show the
  // commit that was just made from the box above it.
  const commit: IGitStatus['run'] = useCallback(
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
          <span className="git-branch" title={status.upstream || 'No upstream branch'}>
            <i className="fas fa-code-branch"></i> {status.branch}
          </span>
          {status.upstream !== '' && (
            <span
              className="git-sync-counts"
              title={`${status.behind} behind, ${status.ahead} ahead of ${status.upstream}`}
            >
              <i className="fas fa-arrow-down"></i> {status.behind}
              <i className="fas fa-arrow-up"></i> {status.ahead}
            </span>
          )}
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
          <div className="panel-section-body">
            <p>This project is not a git repository.</p>
          </div>
        )}

        {status.isRepository && (
          <>
            <CommitBox status={status} busy={busy} run={commit} />

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
          <CommitGraphContainer hidden={hidden} reloadKey={historyKey} />
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
