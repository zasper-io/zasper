import { Icon } from '@/ide/icons';
import { useTabActions } from '@/store/tabActions';

interface DiskChangeBandProps {
  path: string;
  name: string;
  /** A save was refused because of the change, rather than the change being seen first. */
  refused?: boolean;
  /** Who changed it, when they did it through Zasper and named themselves. */
  by?: string;
  /** Records the two versions for the comparison tab, which is opened straight after. */
  onCompare: () => void;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}

/**
 * Under the breadcrumb of a file that changed on disk while it had unsaved edits. After a refused save,
 * keeping the reader's version is a save, so the button says what it does.
 */
export default function DiskChangeBand(props: DiskChangeBandProps) {
  const { openDiskCompare } = useTabActions();

  return (
    <div className="z-notice z-notice-error" role="alert">
      <Icon name="circle-alert" size={14} />
      {props.refused ? (
        <p>
          <strong>{props.name} was not saved.</strong>{' '}
          {props.by ? `${props.by} changed it` : 'It changed on disk'} after you opened it, and
          saving would have overwritten that.
        </p>
      ) : (
        <p>
          <strong>
            {props.by ? `${props.by} changed ${props.name}.` : `${props.name} changed on disk.`}
          </strong>{' '}
          You have unsaved edits to it as well.
        </p>
      )}
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
          {props.refused ? 'Overwrite' : 'Keep mine'}
        </button>
        <button
          type="button"
          className="z-button z-button-secondary z-notice-action"
          onClick={props.onTakeTheirs}
        >
          Take theirs
        </button>
      </span>
    </div>
  );
}
