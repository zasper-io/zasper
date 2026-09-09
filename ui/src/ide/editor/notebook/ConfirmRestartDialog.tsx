import { Icon } from '@/ide/icons';
import { useDismissOnEscape } from '@/ide/overlays';

/** Which of the two restart actions is being confirmed; they lose different amounts of work. */
export type RestartIntent = 'restart' | 'restart-and-run-all';

interface ConfirmRestartDialogProps {
  intent: RestartIntent;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asked before either restart, for the same reason `ConfirmShutdownDialog` guards a shutdown: every
 * variable in the kernel goes with it and the only way back is to run the notebook again. The
 * run-all variant additionally discards every output in the file, which is not recoverable by
 * `notebook:undo-cell-change` — the undo stack covers structural edits, not a kernel's replies.
 *
 * Both used to fire straight off a single toolbar click, and the two buttons sit beside each other.
 */
export default function ConfirmRestartDialog(props: ConfirmRestartDialogProps) {
  const { intent, onCancel } = props;
  const runsAll = intent === 'restart-and-run-all';

  useDismissOnEscape(onCancel);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirmRestartTitle">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head" id="confirmRestartTitle">
            {runsAll ? 'Restart kernel and run all cells' : 'Restart kernel'}
            <button
              type="button"
              className="z-icon-button on-chrome modal-btn-close"
              aria-label="Close"
              onClick={onCancel}
            >
              <Icon name="x" />
            </button>
          </div>
          <div className="modal-body">
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
            <div className="modal-actions">
              {/* Cancel takes the focus: the destructive answer should not be one Enter away. */}
              <button className="z-button z-button-secondary" autoFocus onClick={onCancel}>
                Cancel
              </button>
              <button className="z-button z-button-danger" onClick={props.onConfirm}>
                {runsAll ? 'Restart and run all' : 'Restart'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
