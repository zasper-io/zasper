import { FileChange } from '@/api';
import { baseName, parentDirOf } from '@/paths';

/** One button offered on every row of a section, and on the heading for all of them at once. */
export interface IChangeAction {
  /** Names the button, for its tooltip and for anything reading the panel aloud. */
  label: string;
  /** A Font Awesome class, as everywhere else in the sidebar. */
  icon: string;
  run: (paths: string[]) => void;
}

interface ChangeListProps {
  title: string;
  changes: FileChange[];
  /**
   * Which side of the index this section is about. A file staged and then edited again appears in two
   * sections, and the letter it shows is different in each: what is about to be committed, and what is
   * not.
   */
  side: 'staged' | 'worktree';
  disabled: boolean;
  actions: IChangeAction[];
  onSelect?: (change: FileChange) => void;
}

/** Git's letters spelt out, since a bare A or D means nothing to most people. */
const MEANING: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Conflicted',
  '?': 'Untracked',
};

/** A section of the panel: a heading that counts what is in it, and a row per path. */
export default function ChangeList(props: ChangeListProps) {
  const { changes, side, disabled, actions, onSelect } = props;

  if (changes.length === 0) {
    return null;
  }

  const everything = changes.map((change) => change.path);

  return (
    <>
      <h2 className="z-subheading panel-section-head change-list-head">
        <span>
          {props.title} <span className="change-count">{changes.length}</span>
        </span>
        <span className="change-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="editor-button change-action"
              // "Stage all", from "Stage": one label per action rather than two to keep in step.
              title={`${action.label} all`}
              aria-label={`${action.label} all`}
              disabled={disabled}
              onClick={() => action.run(everything)}
            >
              <i className={action.icon} />
            </button>
          ))}
        </span>
      </h2>

      <ul className="change-list list-unstyled noborder-list">
        {changes.map((change) => {
          const letter = side === 'staged' ? change.staged : change.worktree;
          const directory = parentDirOf(change.path);

          return (
            <li key={`${side}:${change.path}`} className="change-row">
              <button
                type="button"
                className="change-name"
                title={change.from === undefined ? change.path : `${change.from} → ${change.path}`}
                onClick={() => onSelect?.(change)}
              >
                <span className="change-file">{baseName(change.path)}</span>
                {directory !== '' && <span className="change-dir">{directory}</span>}
              </button>

              <span className="change-actions">
                {actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="editor-button change-action"
                    title={`${action.label} ${change.path}`}
                    aria-label={`${action.label} ${change.path}`}
                    disabled={disabled}
                    onClick={() => action.run([change.path])}
                  >
                    <i className={action.icon} />
                  </button>
                ))}
                <span
                  className={`change-badge change-badge-${letter === '?' ? 'untracked' : letter}`}
                  title={MEANING[letter] ?? letter}
                >
                  {letter}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
