import { useEffect } from 'react';

interface ConfirmShutdownDialogProps {
  /** What the kernel is called, as the row shows it. */
  name: string;
  /** The file it is running, when something is attached to it. */
  path?: string;
  /** True while the shutdown is in flight, so nothing can be pressed twice. */
  shuttingDown: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asked before a kernel is shut down, because every variable in it goes with it and there is no way
 * back short of running the whole notebook again. Interrupting is not asked about: it stops the cell
 * running and leaves the state alone.
 */
export default function ConfirmShutdownDialog(props: ConfirmShutdownDialogProps) {
  const { name, path, shuttingDown, onCancel } = props;

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !shuttingDown) {
        onCancel();
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [shuttingDown, onCancel]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirmShutdownTitle">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head" id="confirmShutdownTitle">
            Shut down kernel
            <button
              type="button"
              className="modal-btn-close"
              aria-label="Close"
              disabled={shuttingDown}
              onClick={onCancel}
            >
              <i className="fas fa-times-circle"></i>
            </button>
          </div>
          <div className="modal-body">
            {/* One paragraph with breaks: .update-kernel-popup is a space-between flex row, so
                sentences in separate <p>s sit side by side. */}
            <div className="update-kernel-popup">
              <p>
                Shut down <strong>{name}</strong>
                {path !== undefined && (
                  <>
                    , running <strong>{path}</strong>
                  </>
                )}
                ?
                <br />
                Everything it holds in memory is lost.
              </p>
            </div>
            <div className="modal-actions">
              {/* Cancel takes the focus: the destructive answer should not be one Enter away. */}
              <button
                className="z-button z-button-secondary"
                autoFocus
                disabled={shuttingDown}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                className="z-button z-button-danger"
                disabled={shuttingDown}
                onClick={props.onConfirm}
              >
                {shuttingDown ? 'Shutting down…' : 'Shut down'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
