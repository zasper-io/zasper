import { Icon } from '@/ide/icons';
import { useTabActions } from '@/store/tabActions';

interface DiskChangeBandProps {
  path: string;
  name: string;
  /** Records the two versions for the comparison tab, which is opened straight after. */
  onCompare: () => void;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}

/** Under the breadcrumb of a file that changed on disk while it had unsaved edits. */
export default function DiskChangeBand(props: DiskChangeBandProps) {
  const { openDiskCompare } = useTabActions();

  return (
    <div className="z-notice z-notice-error" role="alert">
      <Icon name="circle-alert" size={14} />
      <p>
        <strong>{props.name} changed on disk.</strong> You have unsaved edits to it as well.
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
          Take theirs
        </button>
      </span>
    </div>
  );
}
