import ConfirmDialog, { summariseNames } from '@/ide/ConfirmDialog';

interface ConfirmDiscardDialogProps {
  /** Paths git knows about: discarding one puts back what was committed or staged. */
  tracked: string[];
  /** Paths git does not: there is no version to put back, so discarding one deletes it. */
  untracked: string[];
  discarding: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asked before work is thrown away: git keeps no copy of an uncommitted change, and there is no trash. */
export default function ConfirmDiscardDialog(props: ConfirmDiscardDialogProps) {
  const { tracked, untracked } = props;

  return (
    <ConfirmDialog
      title="Discard changes"
      confirmLabel="Discard"
      busyLabel="Discarding…"
      busy={props.discarding}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    >
      {/* One paragraph with breaks: .update-kernel-popup is a space-between flex row. */}
      <div className="update-kernel-popup">
        <p>
          {tracked.length > 0 && (
            <>
              Throw away the changes to <strong>{summariseNames(tracked)}</strong>?
              <br />
            </>
          )}
          {untracked.length > 0 && (
            <>
              <strong>{summariseNames(untracked)}</strong> {untracked.length > 1 ? 'are' : 'is'} not
              tracked by git, so {untracked.length > 1 ? 'they' : 'it'} will be deleted.
              <br />
            </>
          )}
          This cannot be undone.
        </p>
      </div>
    </ConfirmDialog>
  );
}
