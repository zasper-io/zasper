import { useAtom, useAtomValue, useSetAtom } from 'jotai';

import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { closeTerminalAtom, currentTerminalAtom, terminalsAtom } from '@/store/terminals';
import TerminalView from './Terminal';
import './TerminalPanel.scss';

/**
 * The shells this window has open, in the panel under the editor.
 *
 * Every one of them stays mounted and all but one are hidden, which is what the tab strip did for them
 * before: a socket torn down and remade is a new shell wearing an old name. The list beside the pane is
 * what the strip gave away for nothing — with one shell it says where that shell was started, and with
 * three it is the only way to reach the other two.
 *
 * It is drawn for one shell as well as for three, which it was not until the rows carried a close: the
 * strip's own close went with the tabs, and without a row for it a single shell was one nothing in this
 * window could shut down.
 */
export default function TerminalPanel({ hidden = false }: { hidden?: boolean }) {
  const terminals = useAtomValue(terminalsAtom);
  const [current, setCurrent] = useAtom(currentTerminalAtom);
  const closeTerminal = useSetAtom(closeTerminalAtom);
  const names = Object.keys(terminals);

  if (names.length === 0) {
    return hidden ? null : (
      <p className="z-note">No terminal is running. The status bar starts one.</p>
    );
  }

  const shown = terminals[current] === undefined ? names[0] : current;

  return (
    <div className="terminalPanel" hidden={hidden}>
      {names.map((name) => (
        <div
          key={name}
          className="terminalPanel-pane"
          // `hidden` rather than unmounting, and never `display: none` on the pane itself: xterm
          // measures the element it is in, and one with no layout box answers 100 pixels.
          hidden={name !== shown}
        >
          <TerminalView id={name} cwd={terminals[name].cwd} />
        </div>
      ))}
      <ul className="terminalPanel-list">
        {names.map((name) => (
          <li key={name} className={name === shown ? 'panel-row is-selected' : 'panel-row'}>
            <button
              type="button"
              className="panel-row-name"
              aria-current={name === shown}
              onClick={() => setCurrent(name)}
            >
              <Icon name="terminal" />
              <span className="panel-row-label">{name}</span>
            </button>
            {/* Closing the row is closing the shell: the pane unmounts, its socket goes, and the
                server ends the session that socket was. Named, because three rows of `Close` are
                three buttons a screen reader cannot tell apart. */}
            <span className="panel-row-actions">
              <IconButton
                icon="x"
                className="panel-row-action"
                label={`Close ${name}`}
                onClick={() => closeTerminal(name)}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
