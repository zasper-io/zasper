import { useEffect, useState } from 'react';

interface ConfirmDeleteBranchDialogProps {
  name: string;
  /** True while the delete is in flight, so nothing can be pressed twice. */
  deleting: boolean;
  onConfirm: (force: boolean) => void;
  onCancel: () => void;
}

/**
 * Asked before a branch goes, with the one question git would otherwise ask by refusing.
 *
 * `git branch -d` declines a branch whose commits are on no other branch, and says to run `-D` instead —
 * which is a fine answer in a terminal and a dead end in a panel. So the choice is offered here: unticked
 * is `-d`, and a branch with unmerged work is still refused; ticked is the user saying they know.
 */
export default function ConfirmDeleteBranchDialog(props: ConfirmDeleteBranchDialogProps) {
  const { name, deleting, onCancel } = props;
  const [force, setForce] = useState<boolean>(false);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) {
        onCancel();
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [deleting, onCancel]);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmDeleteBranchTitle"
    >
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head" id="confirmDeleteBranchTitle">
            Delete branch
            <button
              type="button"
              className="modal-btn-close"
              aria-label="Close"
              disabled={deleting}
              onClick={onCancel}
            >
              <i className="fas fa-times-circle"></i>
            </button>
          </div>
          <div className="modal-body">
            <div className="update-kernel-popup">
              <p>
                Delete the branch <strong>{name}</strong>?
                <br />
                {/* The reassuring half, and the true one: deleting a branch deletes a name, and the
                    commits it named are still reachable from wherever else they are. */}
                Nothing is deleted from any commit that is also on another branch.
              </p>
            </div>
            <label className="modal-choice">
              <input
                type="checkbox"
                checked={force}
                disabled={deleting}
                onChange={(event) => setForce(event.target.checked)}
              />
              Delete it even if it has commits that are on no other branch
            </label>
            <div className="modal-actions">
              {/* Cancel takes the focus: the destructive answer should not be one Enter away. */}
              <button
                className="z-button z-button-secondary"
                autoFocus
                disabled={deleting}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                className="z-button z-button-danger"
                disabled={deleting}
                onClick={() => props.onConfirm(force)}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
