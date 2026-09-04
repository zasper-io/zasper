import { useEffect } from 'react';

interface ConfirmDiscardDialogProps {
  /** Paths git knows about: discarding one puts back what was committed or staged. */
  tracked: string[];
  /** Paths git does not: there is no version to put back, so discarding one deletes it. */
  untracked: string[];
  /** True while the discard is in flight, so nothing can be pressed twice. */
  discarding: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Names them, up to a point: a whole section can be discarded at once. */
function summarise(names: string[]): string {
  const shown = names.slice(0, 8);
  const rest = names.length - shown.length;
  return rest === 0 ? shown.join(', ') : `${shown.join(', ')} and ${rest} more`;
}

/**
 * Asked before any work is thrown away. Git keeps no copy of an uncommitted change and Zasper has no
 * trash, so this is the last chance — the same reason the file browser asks before a delete.
 */
export default function ConfirmDiscardDialog(props: ConfirmDiscardDialogProps) {
  const { tracked, untracked, discarding, onCancel } = props;

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !discarding) {
        onCancel();
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [discarding, onCancel]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirmDiscardTitle">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head" id="confirmDiscardTitle">
            Discard changes
            <button
              type="button"
              className="modal-btn-close"
              aria-label="Close"
              disabled={discarding}
              onClick={onCancel}
            >
              <i className="fas fa-times-circle"></i>
            </button>
          </div>
          <div className="modal-body">
            {/* One paragraph with breaks, as ConfirmDeleteDialog has: .update-kernel-popup is a
                space-between flex row, so sentences in separate <p>s sit side by side. */}
            <div className="update-kernel-popup">
              <p>
                {tracked.length > 0 && (
                  <>
                    Throw away the changes to <strong>{summarise(tracked)}</strong>?
                    <br />
                  </>
                )}
                {/* Said apart from the above because it is a different thing happening: not a revert,
                    a delete. */}
                {untracked.length > 0 && (
                  <>
                    <strong>{summarise(untracked)}</strong> {untracked.length > 1 ? 'are' : 'is'}{' '}
                    not tracked by git, so {untracked.length > 1 ? 'they' : 'it'} will be deleted.
                    <br />
                  </>
                )}
                This cannot be undone.
              </p>
            </div>
            <div className="modal-actions">
              {/* Cancel takes the focus: the destructive answer should not be one Enter away. */}
              <button
                className="z-button z-button-secondary"
                autoFocus
                disabled={discarding}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                className="z-button z-button-danger"
                disabled={discarding}
                onClick={props.onConfirm}
              >
                {discarding ? 'Discarding…' : 'Discard'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
