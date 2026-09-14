import ConfirmDialog from '@/ide/ConfirmDialog';

/** Which of the two restart actions is being confirmed; they lose different amounts of work. */
export type RestartIntent = 'restart' | 'restart-and-run-all';

interface ConfirmRestartDialogProps {
  intent: RestartIntent;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asked before either restart, because every variable in the kernel goes with it. Run-all also replaces
 * every output, which cell undo does not bring back.
 */
export default function ConfirmRestartDialog(props: ConfirmRestartDialogProps) {
  const runsAll = props.intent === 'restart-and-run-all';

  return (
    <ConfirmDialog
      title={runsAll ? 'Restart kernel and run all cells' : 'Restart kernel'}
      confirmLabel={runsAll ? 'Restart and run all' : 'Restart'}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    >
      <div className="update-kernel-popup">
        <p>
          {runsAll ? (
            <>
              Restart the kernel and run every cell from the top?
              <br />
              Everything it holds in memory is lost, and every existing output is replaced.
            </>
          ) : (
            <>
              Restart the kernel?
              <br />
              Everything it holds in memory is lost. Outputs already in the notebook stay.
            </>
          )}
        </p>
      </div>
    </ConfirmDialog>
  );
}
