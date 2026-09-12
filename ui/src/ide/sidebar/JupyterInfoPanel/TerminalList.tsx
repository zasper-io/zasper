import { ITerminalModel } from '@/api';
import IconButton from '@/ide/IconButton';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import { fullDate, relativeDate, shortAgo } from '../dates';

interface TerminalListProps {
  terminals: ITerminalModel[];
  /**
   * The names of the terminal tabs this window has open. A shell belonging to another window can be
   * listed and shut down but not opened: a tab here would start a second shell of the same name.
   */
  local: Set<string>;
  disabled: boolean;
  onOpen: (terminal: ITerminalModel) => void;
  onShutdown: (terminal: ITerminalModel) => void;
}

function tooltip(terminal: ITerminalModel, mine: boolean): string[] {
  const lines = [terminal.dir === '' ? 'Project root' : terminal.dir, terminal.id];
  const when = relativeDate(terminal.started);
  if (when !== '') {
    lines.push(`Started ${when} — ${fullDate(terminal.started)}`);
  }
  if (!mine) {
    lines.push('Opened in another window');
  }
  return lines;
}

/** The shells the server is running: where each one is, and the one thing to do to it. */
export default function TerminalList({
  terminals,
  local,
  disabled,
  onOpen,
  onShutdown,
}: TerminalListProps) {
  return (
    <ul className="z-list-plain noborder-list">
      {terminals.map((terminal) => (
        <TerminalRow
          key={terminal.id}
          terminal={terminal}
          mine={local.has(terminal.name)}
          disabled={disabled}
          onOpen={onOpen}
          onShutdown={onShutdown}
        />
      ))}
    </ul>
  );
}

interface TerminalRowProps {
  terminal: ITerminalModel;
  /** Opened by this window, which is the only kind it can bring forward. */
  mine: boolean;
  disabled: boolean;
  onOpen: (terminal: ITerminalModel) => void;
  onShutdown: (terminal: ITerminalModel) => void;
}

/** One shell. Its own component for its own tooltips — the row's, and the stamp's. */
function TerminalRow({ terminal, mine, disabled, onOpen, onShutdown }: TerminalRowProps) {
  const since = shortAgo(terminal.started);
  const rowTip = useTooltip();
  const sinceTip = useTooltip();

  return (
    <li className="panel-row">
      <button
        type="button"
        className="panel-row-name"
        disabled={!mine}
        onClick={() => onOpen(terminal)}
        {...rowTip.anchorProps}
      >
        <span className="panel-row-label">{terminal.name}</span>
        {/* The folder, which is what tells two shells apart — including the two called
            `Terminal 1` that two windows each with a terminal open produce. */}
        {terminal.dir !== '' && <span className="panel-row-meta">{terminal.dir}</span>}
      </button>
      <Tooltip tip={rowTip} label={tooltip(terminal, mine)} />

      {since !== '' && (
        <>
          <span className="panel-row-time z-tabular" {...sinceTip.anchorProps}>
            {since}
          </span>
          <Tooltip tip={sinceTip} label={`Started ${relativeDate(terminal.started)}`} />
        </>
      )}

      <span className="panel-row-actions">
        <IconButton
          icon="power"
          className="panel-row-action"
          label={`Shut down ${terminal.name}`}
          disabled={disabled}
          onClick={() => onShutdown(terminal)}
        />
      </span>
    </li>
  );
}
