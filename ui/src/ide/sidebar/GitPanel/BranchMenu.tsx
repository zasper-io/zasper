import { useCallback, useEffect, useRef, useState } from 'react';

import {
  apiErrorMessage,
  Branch,
  checkoutBranch,
  deleteBranch,
  getBranches,
  GitStatus,
} from '@/api';
import ConfirmDeleteBranchDialog from './ConfirmDeleteBranchDialog';
import { IGitStatus } from './useGitStatus';

interface BranchMenuProps {
  status: GitStatus;
  busy: boolean;
  run: IGitStatus['run'];
  onClose: () => void;
}

/**
 * The branch list: switch to one, make one, delete one.
 *
 * The list is read when the menu opens rather than kept in the panel's status, because it is only ever
 * looked at while the menu is open and a repository can have hundreds of remote-tracking refs — none of
 * which the panel needs to draw itself.
 *
 * The filter box doubles as the name for a new branch, so there is one field rather than a list and a
 * separate "New branch…" dialog: typing a name that does not exist offers to create it.
 */
export default function BranchMenu({ status, busy, run, onClose }: BranchMenuProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [filter, setFilter] = useState<string>('');
  // The branch a delete has been asked for and not yet confirmed.
  const [pending, setPending] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const answer = await getBranches();
      setBranches(answer.branches);
      setError('');
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Dismissed the way the file browser's context menu is: Escape, or a press anywhere outside. Held open
  // while the delete dialog is up, whose own Escape closes that instead.
  useEffect(() => {
    if (pending !== null) {
      return;
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const dismissOnPressOutside = (event: MouseEvent) => {
      if (menu.current !== null && !menu.current.contains(event.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', dismiss);
    window.addEventListener('mousedown', dismissOnPressOutside);
    return () => {
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('mousedown', dismissOnPressOutside);
    };
  }, [onClose, pending]);

  const wanted = filter.trim();
  const matching = branches.filter((branch) =>
    branch.name.toLowerCase().includes(wanted.toLowerCase())
  );
  // Offered only for a name nothing already has, so the row cannot mean two things at once.
  const canCreate = wanted !== '' && !branches.some((branch) => branch.name === wanted);
  const disabled = busy || !status.gitAvailable;

  const switchTo = async (branch: Branch) => {
    // A remote-tracking ref is checked out as a local branch following it, so the name that ends up on
    // HEAD is not the one that was clicked.
    const worked = await run(
      () => checkoutBranch(branch.name),
      branch.isRemote
        ? `Switched to a local branch following ${branch.name}.`
        : `Switched to ${branch.name}.`
    );
    if (worked) {
      onClose();
    }
  };

  const create = async () => {
    const worked = await run(() => checkoutBranch(wanted, { create: true }), `Created ${wanted}.`);
    if (worked) {
      onClose();
    }
  };

  const confirmDelete = async (force: boolean) => {
    const name = pending ?? '';
    setPending(null);
    const worked = await run(() => deleteBranch(name, force), `Deleted ${name}.`);
    // The list is what changed, and the menu stays open: deleting branches is usually done in a batch.
    if (worked) {
      void load();
    }
  };

  return (
    <div className="git-branch-menu" ref={menu}>
      <input
        className="gitpanel-input git-branch-filter"
        value={filter}
        autoFocus
        placeholder="Find or create a branch"
        aria-label="Find or create a branch"
        disabled={disabled}
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') {
            return;
          }
          event.preventDefault();
          if (canCreate) {
            void create();
            return;
          }
          // The first branch that is not the one already checked out: Enter on the current branch would
          // be a checkout that does nothing.
          const first = matching.find((branch) => !branch.current);
          if (first !== undefined) {
            void switchTo(first);
          }
        }}
      />

      {error !== '' && (
        <div className="panel-error">
          <p>{error}</p>
        </div>
      )}

      <ul className="git-branch-list list-unstyled noborder-list" role="menu">
        {canCreate && (
          <li className="git-branch-row" role="none">
            <button
              type="button"
              className="git-branch-option git-branch-create"
              role="menuitem"
              disabled={disabled}
              onClick={() => void create()}
            >
              <i className="fas fa-plus"></i>
              <span className="git-branch-option-name">Create branch {wanted}</span>
            </button>
          </li>
        )}

        {matching.map((branch) => (
          <li key={branch.name} className="git-branch-row" role="none">
            <button
              type="button"
              className={branch.current ? 'git-branch-option is-current' : 'git-branch-option'}
              role="menuitem"
              title={
                branch.upstream === undefined ? branch.name : `${branch.name} → ${branch.upstream}`
              }
              disabled={disabled || branch.current}
              onClick={() => void switchTo(branch)}
            >
              <i className={branch.current ? 'fas fa-check' : 'fas fa-code-branch'}></i>
              <span className="git-branch-option-name">{branch.name}</span>
              {branch.isRemote && <span className="git-branch-remote">remote</span>}
            </button>

            {/* Only this repository's own branches, and never the one that is checked out: git refuses
                both, and a button that is always refused is not worth drawing. */}
            {!branch.isRemote && !branch.current && (
              <button
                type="button"
                className="editor-button git-branch-delete"
                title={`Delete ${branch.name}`}
                aria-label={`Delete ${branch.name}`}
                disabled={disabled}
                onClick={() => setPending(branch.name)}
              >
                <i className="fas fa-trash"></i>
              </button>
            )}
          </li>
        ))}

        {!loading && matching.length === 0 && !canCreate && (
          <li className="git-branch-empty" role="none">
            No branches match.
          </li>
        )}
      </ul>

      {pending !== null && (
        <ConfirmDeleteBranchDialog
          name={pending}
          deleting={busy}
          onConfirm={(force) => void confirmDelete(force)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
