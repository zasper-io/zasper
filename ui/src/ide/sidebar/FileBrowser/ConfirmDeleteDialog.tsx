import { useEffect } from 'react';

interface ConfirmDeleteDialogProps {
  /** Everything about to go: one name, or several when a selection is being deleted. */
  names: string[];
  /** Folders take everything inside them, which is worth saying before they go. */
  isFolder: boolean;
  /** True while the delete is in flight, so nothing can be pressed twice. */
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Names them, up to a point: a selection can be long, and a dialog taller than the window is no use. */
function summarise(names: string[]): string {
  const shown = names.slice(0, 8);
  const rest = names.length - shown.length;
  return rest === 0 ? shown.join(', ') : `${shown.join(', ')} and ${rest} more`;
}

/** Asked before anything is deleted from the file browser: there is no undo and no trash. */
export default function ConfirmDeleteDialog(props: ConfirmDeleteDialogProps) {
  const { deleting, names, onCancel } = props;
  const several = names.length > 1;

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
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirmDeleteTitle">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head" id="confirmDeleteTitle">
            {several ? 'Delete items' : props.isFolder ? 'Delete folder' : 'Delete file'}
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
              {several ? (
                <p>
                  Delete <strong>{names.length} items</strong>? Folders take everything inside them.
                  <br />
                  {summarise(names)}
                  <br />
                  This cannot be undone.
                </p>
              ) : (
                <p>
                  Delete <strong>{names[0]}</strong>
                  {props.isFolder ? ' and everything inside it' : ''}?
                  <br />
                  This cannot be undone.
                </p>
              )}
            </div>
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
                onClick={props.onConfirm}
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
