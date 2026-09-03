import { useEffect } from 'react';

interface UnsavedChangesDialogProps {
  /** The tab's name, as the tab bar shows it. */
  name: string;
  /** True while the save is in flight, so nothing can be pressed twice. */
  saving: boolean;
  /** Why the save failed, if it did. */
  error: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/** Asked before an unsaved tab is closed: save, discard or cancel. */
export default function UnsavedChangesDialog(props: UnsavedChangesDialogProps) {
  const { saving, onCancel } = props;

  useEffect(() => {
    // Escape means cancel, as it does for the command palette. Ignored mid-save: the write is
    // already on its way.
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        onCancel();
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [saving, onCancel]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unsavedChangesTitle">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head" id="unsavedChangesTitle">
            Unsaved changes
            <button
              type="button"
              className="modal-btn-close"
              aria-label="Close"
              disabled={saving}
              onClick={onCancel}
            >
              <i className="fas fa-times-circle"></i>
            </button>
          </div>
          <div className="modal-body">
            <div className="update-kernel-popup">
              <p>
                Do you want to save the changes you made to <strong>{props.name}</strong>?
                <br />
                Your changes will be lost if you don&apos;t save them.
              </p>
            </div>
            {props.error !== '' && (
              <div className="update-kernel-popup modal-error" role="alert">
                <p>{props.error}</p>
              </div>
            )}
            <div className="modal-actions">
              <button className="z-button" autoFocus disabled={saving} onClick={props.onSave}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                className="z-button z-button-secondary"
                disabled={saving}
                onClick={props.onDiscard}
              >
                Don&apos;t Save
              </button>
              <button className="z-button z-button-secondary" disabled={saving} onClick={onCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
