import { useState } from 'react';

import ConfirmDialog from '@/ide/ConfirmDialog';

interface ConfirmDeleteBranchDialogProps {
  name: string;
  deleting: boolean;
  onConfirm: (force: boolean) => void;
  onCancel: () => void;
}

/**
 * Asked before a branch goes. `git branch -d` refuses a branch whose commits are on no other branch, so
 * the checkbox is `-D`: the user saying they know.
 */
export default function ConfirmDeleteBranchDialog(props: ConfirmDeleteBranchDialogProps) {
  const { name, deleting } = props;
  const [force, setForce] = useState<boolean>(false);

  return (
    <ConfirmDialog
      title="Delete branch"
      confirmLabel="Delete"
      busyLabel="Deleting…"
      busy={deleting}
      onConfirm={() => props.onConfirm(force)}
      onCancel={props.onCancel}
    >
      <div className="update-kernel-popup">
        <p>
          Delete the branch <strong>{name}</strong>?
          <br />
          Nothing is deleted from any commit that is also on another branch.
        </p>
      </div>
      <label className="z-checkbox modal-choice">
        <input
          type="checkbox"
          checked={force}
          disabled={deleting}
          onChange={(event) => setForce(event.target.checked)}
        />
        Delete it even if it has commits that are on no other branch
      </label>
    </ConfirmDialog>
  );
}
