import ConfirmDialog from '@/ide/ConfirmDialog';

interface ConfirmShutdownDialogProps {
  /** What the kernel is called, as the row shows it. */
  name: string;
  /** The file it is running, when something is attached to it. */
  path?: string;
  shuttingDown: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asked before a kernel is shut down, because everything in it goes with it. Interrupting is not asked
 * about: it stops the running cell and leaves the state alone.
 */
export default function ConfirmShutdownDialog(props: ConfirmShutdownDialogProps) {
  const { name, path } = props;

  return (
    <ConfirmDialog
      title="Shut down kernel"
      confirmLabel="Shut down"
      busyLabel="Shutting down…"
      busy={props.shuttingDown}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    >
      {/* One paragraph with breaks: .update-kernel-popup is a space-between flex row. */}
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
    </ConfirmDialog>
  );
}
