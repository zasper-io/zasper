import { ITerminalModel } from '@/api';
import { Icon } from '@/ide/icons';
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

function tooltip(terminal: ITerminalModel, mine: boolean): string {
  const lines = [terminal.dir === '' ? 'Project root' : terminal.dir, terminal.id];
  const when = relativeDate(terminal.started);
  if (when !== '') {
    lines.push(`Started ${when} — ${fullDate(terminal.started)}`);
  }
  if (!mine) {
    lines.push('Opened in another window');
  }
  return lines.join('\n');
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
      {terminals.map((terminal) => {
        const mine = local.has(terminal.name);
        const since = shortAgo(terminal.started);

        return (
          <li className="panel-row" key={terminal.id}>
            <button
              type="button"
              className="panel-row-name"
              title={tooltip(terminal, mine)}
              disabled={!mine}
              onClick={() => onOpen(terminal)}
            >
              <span className="panel-row-label">{terminal.name}</span>
              {/* The folder, which is what tells two shells apart — including the two called
                  `Terminal 1` that two windows each with a terminal open produce. */}
              {terminal.dir !== '' && <span className="panel-row-meta">{terminal.dir}</span>}
            </button>

            {since !== '' && (
              <span
                className="panel-row-time z-tabular"
                title={`Started ${relativeDate(terminal.started)}`}
              >
                {since}
              </span>
            )}

            <span className="panel-row-actions">
              <button
                type="button"
                className="z-icon-button panel-row-action"
                title={`Shut down ${terminal.name}`}
                aria-label={`Shut down ${terminal.name}`}
                disabled={disabled}
                onClick={() => onShutdown(terminal)}
              >
                <Icon name="power" />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
