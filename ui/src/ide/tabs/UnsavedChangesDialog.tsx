import ConfirmDialog from '@/ide/ConfirmDialog';
import { FileMark } from '@/ide/icons';

interface UnsavedChangesDialogProps {
  /** The tabs' names: one for a tab's ×, every unsaved one for a batch close. */
  names: string[];
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

  return (
    <ConfirmDialog
      title="Unsaved changes"
      busy={saving}
      onCancel={onCancel}
      actions={
        <>
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
        </>
      }
    >
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
    </ConfirmDialog>
  );
}
