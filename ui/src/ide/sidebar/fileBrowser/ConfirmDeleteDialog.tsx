import ConfirmDialog, { summariseNames } from '@/ide/ConfirmDialog';

interface ConfirmDeleteDialogProps {
  /** Everything about to go: one name, or several when a selection is being deleted. */
  names: string[];
  isFolder: boolean;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asked before anything is deleted from the file browser: there is no undo and no trash. */
export default function ConfirmDeleteDialog(props: ConfirmDeleteDialogProps) {
  const { names, isFolder, deleting } = props;
  const several = names.length > 1;

  return (
    <ConfirmDialog
      title={several ? 'Delete items' : isFolder ? 'Delete folder' : 'Delete file'}
      confirmLabel="Delete"
      busyLabel="Deleting…"
      busy={deleting}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    >
      <div className="update-kernel-popup">
        {several ? (
          <p>
            Delete <strong>{names.length} items</strong>? Folders take everything inside them.
            <br />
            {summariseNames(names)}
            <br />
            This cannot be undone.
          </p>
        ) : (
          <p>
            Delete <strong>{names[0]}</strong>
            {isFolder ? ' and everything inside it' : ''}?
            <br />
            This cannot be undone.
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
