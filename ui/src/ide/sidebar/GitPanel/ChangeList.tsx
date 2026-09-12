import { FileChange } from '@/api';
import type { IconName } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import { baseName, parentDirOf } from '@/paths';

/** One button offered on every row of a section, and on the heading for all of them at once. */
export interface IChangeAction {
  /** Names the button, for its tooltip and for anything reading the panel aloud. */
  label: string;
  /** Which glyph the button wears — a key of the icon table in src/ide/icons/icons.ts. */
  icon: IconName;
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
      <h2 className="z-label panel-section-head change-list-head">
        <span>
          {props.title} <span className="panel-section-count">{changes.length}</span>
        </span>
        <span className="panel-row-actions">
          {actions.map((action) => (
            <IconButton
              key={action.label}
              icon={action.icon}
              className="panel-row-action"
              // "Stage all", from "Stage": one label per action rather than two to keep in step.
              label={`${action.label} all`}
              disabled={disabled}
              onClick={() => action.run(everything)}
            />
          ))}
        </span>
      </h2>

      <ul className="change-list z-list-plain noborder-list">
        {changes.map((change) => (
          <ChangeRow
            key={`${side}:${change.path}`}
            change={change}
            side={side}
            disabled={disabled}
            actions={actions}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </>
  );
}

interface ChangeRowProps {
  change: FileChange;
  side: 'staged' | 'worktree';
  disabled: boolean;
  actions: IChangeAction[];
  onSelect?: (change: FileChange) => void;
}

/**
 * One path. A row of its own because two things on it have something to say that the 22px it gets
 * cannot hold — where the file actually is, and what git's letter means — and each of those is a
 * `useTooltip` of its own.
 */
function ChangeRow({ change, side, disabled, actions, onSelect }: ChangeRowProps) {
  const letter = side === 'staged' ? change.staged : change.worktree;
  const directory = parentDirOf(change.path);
  const pathTip = useTooltip();
  const letterTip = useTooltip();

  return (
    <li className="panel-row">
      <button
        type="button"
        className="panel-row-name"
        onClick={() => onSelect?.(change)}
        {...pathTip.anchorProps}
      >
        <span className="panel-row-label">{baseName(change.path)}</span>
        {directory !== '' && <span className="panel-row-meta">{directory}</span>}
      </button>
      <Tooltip
        tip={pathTip}
        label={change.from === undefined ? change.path : `${change.from} → ${change.path}`}
      />

      <span className="panel-row-actions">
        {actions.map((action) => (
          <IconButton
            key={action.label}
            icon={action.icon}
            className="panel-row-action"
            label={`${action.label} ${change.path}`}
            disabled={disabled}
            onClick={() => action.run([change.path])}
          />
        ))}
        <span
          className={`change-badge change-badge-${letter === '?' ? 'untracked' : letter}`}
          {...letterTip.anchorProps}
        >
          {letter}
        </span>
        <Tooltip tip={letterTip} label={MEANING[letter] ?? letter} />
      </span>
    </li>
  );
}
