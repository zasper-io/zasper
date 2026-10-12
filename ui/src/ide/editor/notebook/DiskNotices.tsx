import { Icon } from '@/ide/icons';
import { useTabActions } from '@/store/tabActions';

interface NotebookDiskBandProps {
  name: string;
  conflicts: number;
  /** A save was refused because of the change, rather than the change being seen first. */
  refused: boolean;
  /** Scrolls to the first cell that asks. */
  onGoTo: () => void;
}

/** Over a notebook some of whose cells changed on disk as well as here. The choices are on the cells. */
export function NotebookDiskBand(props: NotebookDiskBandProps) {
  const cells = props.conflicts === 1 ? '1 cell' : `${props.conflicts} cells`;
  return (
    <div className="z-notice z-notice-error" role="alert">
      <Icon name="circle-alert" size={14} />
      <p>
        <strong>
          {props.refused ? `${props.name} was not saved.` : `${props.name} changed on disk.`}
        </strong>{' '}
        {cells} changed on both sides.
      </p>
      <button
        type="button"
        className="z-button z-button-secondary z-notice-action"
        onClick={props.onGoTo}
      >
        Go to it
      </button>
    </div>
  );
}

interface CellConflictProps {
  path: string;
  /** The file no longer has this cell. */
  deleted: boolean;
  onCompare: () => void;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}

/** Under a cell that changed on disk while the reader had changed it too. */
export function CellConflict(props: CellConflictProps) {
  const { openDiskCompare } = useTabActions();
  return (
    <div className="z-notice cellDiskNotice is-conflict" role="alert">
      <Icon name="git-branch" size={14} />
      <p>
        <strong>{props.deleted ? 'Deleted on disk.' : 'Changed on both sides.'}</strong> You have
        unsaved edits to this cell.
      </p>
      <span className="editor-notice-actions">
        <button
          type="button"
          className="z-button z-button-secondary z-notice-action"
          onClick={() => {
            props.onCompare();
            openDiskCompare(props.path);
          }}
        >
          Compare
        </button>
        <button
          type="button"
          className="z-button z-button-secondary z-notice-action"
          onClick={props.onKeepMine}
        >
          Keep mine
        </button>
        <button
          type="button"
          className="z-button z-button-secondary z-notice-action"
          onClick={props.onTakeTheirs}
        >
          {props.deleted ? 'Delete it' : 'Take theirs'}
        </button>
      </span>
    </div>
  );
}

/** Under the cell holding the cursor, whose newer version on disk waits for the reader to leave it. */
export function CellHeld({ onUpdate }: { onUpdate: () => void }) {
  return (
    <div className="z-notice cellDiskNotice" role="status">
      <Icon name="refresh-cw" size={14} />
      <p>Changed on disk. It updates when you leave the cell.</p>
      <button
        type="button"
        className="z-button z-button-secondary z-notice-action"
        onClick={onUpdate}
      >
        Update now
      </button>
    </div>
  );
}
