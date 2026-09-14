import { FileMark, Icon } from '@/ide/icons';
import { useDismissOnEscape } from '@/ide/overlays';

interface UnsavedChangesDialogProps {
  /** The tabs' names, as the tab bar shows them: one for a tab's ×, every unsaved one for a batch close. */
  names: string[];
  /** True while the save is in flight, so nothing can be pressed twice. */
  saving: boolean;
  /** Why the save failed, if it did. */
  error: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/** Asked before unsaved tabs are closed: save, discard or cancel, once for however many there are. */
export default function UnsavedChangesDialog(props: UnsavedChangesDialogProps) {
  const { names, saving, onCancel } = props;
  const single = names.length === 1;

  useDismissOnEscape(onCancel, !saving);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unsavedChangesTitle">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head" id="unsavedChangesTitle">
            Unsaved changes
            <button
              type="button"
              className="z-icon-button on-chrome modal-btn-close"
              aria-label="Close"
              disabled={saving}
              onClick={onCancel}
            >
              <Icon name="x" />
            </button>
          </div>
          <div className="modal-body">
            <div className="update-kernel-popup">
              {single ? (
                <p>
                  Do you want to save the changes you made to <strong>{names[0]}</strong>?
                  <br />
                  Your changes will be lost if you don&apos;t save them.
                </p>
              ) : (
                <p>Do you want to save the changes you made to these {names.length} files?</p>
              )}
            </div>
            {!single && (
              <ul className="tabs-unsaved-list">
                {names.map((name, index) => (
                  // By index: two tabs can share a name, a `main.py` in each of two folders.
                  <li key={index}>
                    <FileMark name={name} /> {name}
                  </li>
                ))}
              </ul>
            )}
            {props.error !== '' && (
              <div className="update-kernel-popup modal-error" role="alert">
                <p>{props.error}</p>
              </div>
            )}
            <div className="modal-actions">
              <button className="z-button" autoFocus disabled={saving} onClick={props.onSave}>
                {saving ? 'Saving…' : single ? 'Save' : 'Save All'}
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
