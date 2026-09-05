import React, { useEffect, useMemo, useState } from 'react';
import './Palette.scss';

import { IContentEntry } from '@/api';
import { formatChord } from '@/commands/keys';
import { ICommand } from '@/commands/types';
import { useTabActions } from '@/store/TabActions';
import { useFileMatches } from './useFileMatches';

/** Typed at the start of the query, this drops the files and leaves the commands. */
export const COMMANDS_ONLY = '>';

/**
 * Rows per section while both are on screen.
 *
 * There is no cap in commands-only mode: with nothing else in the list, the whole registry is the
 * answer to an empty query, and that browse-everything view is what the chord is for.
 */
const SHARED_CAP = 6;

/** One row of the list: the two kinds are what Enter can do. */
type PaletteRow = { kind: 'command'; command: ICommand } | { kind: 'file'; file: IContentEntry };

interface PaletteProps {
  commands: ICommand[];
  /** What the field starts with: `>` from the commands chord, empty from the search box. */
  initialQuery: string;
  onClose: () => void;
}

/**
 * One query over the command registry and the file tree.
 *
 * These were two widgets on two chords, which meant knowing before you started typing whether what
 * you wanted was a command or a file. Now they are two sections of one list, commands first because
 * they are the answer that arrives without a round trip — a file match landing later cannot move the
 * row Enter is about to run.
 */
const Palette: React.FC<PaletteProps> = ({ commands, initialQuery, onClose }) => {
  const [query, setQuery] = useState(initialQuery);
  // The first match is selected from the start, so typing a query and pressing Enter runs it — the
  // palette used to open with nothing selected, which made Enter do nothing until you arrowed down.
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const { openTab } = useTabActions();

  const commandsOnly = query.startsWith(COMMANDS_ONLY);
  const typed = (commandsOnly ? query.slice(COMMANDS_ONLY.length) : query).trim();
  const needle = typed.toLowerCase();

  // As typed, not folded: the search endpoint decides how to match, and folding here would only make
  // the two ends disagree about what was asked.
  const files = useFileMatches(commandsOnly ? '' : typed);

  // Category as well as label, so "notebook" finds the notebook's commands whatever they are called.
  // An empty query lists everything only in commands-only mode: from the search box it means nothing
  // has been asked yet, and answering that with the first six commands in registration order is noise.
  const matches = useMemo(() => {
    if (needle === '' && !commandsOnly) {
      return [];
    }
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.category.toLowerCase().includes(needle)
    );
  }, [commands, needle, commandsOnly]);

  const shownCommands = commandsOnly ? matches : matches.slice(0, SHARED_CAP);
  const shownFiles = files.slice(0, SHARED_CAP);

  const rows = useMemo<PaletteRow[]>(
    () => [
      ...shownCommands.map((command): PaletteRow => ({ kind: 'command', command })),
      ...shownFiles.map((file): PaletteRow => ({ kind: 'file', file })),
    ],
    [shownCommands, shownFiles]
  );

  // The list shrinks as the query grows, so a selection made earlier can end up past its end. It
  // lands on -1, i.e. nothing selected, only when the query matches nothing at all.
  useEffect(() => {
    setSelectedIndex((index) => Math.min(Math.max(index, 0), rows.length - 1));
  }, [rows]);

  const activate = (row: PaletteRow) => {
    if (row.kind === 'file') {
      // The same openTab the file browser calls, so a file that is already open comes forward
      // instead of being loaded a second time.
      openTab({ name: row.file.name, path: row.file.path, type: row.file.type });
    } else {
      if (isDisabled(row.command)) {
        return;
      }
      row.command.execute();
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      setSelectedIndex((index) => Math.min(index + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < rows.length) {
      activate(rows[selectedIndex]);
    }
  };

  return (
    <div className="palette">
      <input
        type="text"
        className="palette-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        // The palette covers the button that opened it, so without this the user would be looking at
        // an input that needs a second click before it takes a keystroke.
        autoFocus
        placeholder="Search files, or > for commands"
      />
      {/* One scrolling box over both sections, so a long command list does not push the files out
          of reach of the wheel. Empty when nothing matches, which .palette-list:not(:empty) reads. */}
      <div className="palette-list">
        <Section title="Commands" shown={shownCommands.length} found={matches.length}>
          {shownCommands.map((command, index) => (
            <li
              key={command.id}
              className={rowClass(selectedIndex === index, isDisabled(command))}
              onClick={() => activate({ kind: 'command', command })}
            >
              <div className="commandName">{command.label}</div>
              <div className="commandDescription">{command.description ?? command.category}</div>
              {/* Rendered from the same binding strings the keyboard dispatches, so the two cannot
                  disagree. Deduped: off mac, `Mod-` and `Ctrl-` spellings collapse to one chord. */}
              <div className="commandKeys">{formatKeys(command.keys)}</div>
            </li>
          ))}
        </Section>
        <Section title="Files" shown={shownFiles.length} found={files.length}>
          {shownFiles.map((file, index) => (
            <li
              key={file.path}
              className={rowClass(selectedIndex === shownCommands.length + index, false)}
              onClick={() => activate({ kind: 'file', file })}
            >
              <div className="commandName">{file.name}</div>
              {/* Where it is, and nothing when that is nowhere: a file in the project root has a
                  path equal to its name, and printing both spelled every such row out twice. */}
              <div className="commandDescription">{file.path === file.name ? '' : file.path}</div>
            </li>
          ))}
        </Section>
      </div>
    </div>
  );
};

interface SectionProps {
  title: string;
  /** Rows in this section, and matches behind them: they differ when the cap has bitten. */
  shown: number;
  found: number;
  children: React.ReactNode;
}

/**
 * A headed group of rows, drawn only when it has any.
 *
 * The heading is what makes one list of two kinds of thing readable, and it carries the count so a
 * capped section says so rather than quietly dropping matches.
 */
function Section({ title, shown, found, children }: SectionProps) {
  if (shown === 0) {
    return null;
  }
  return (
    <>
      <div className="palette-heading">
        <span>{title}</span>
        {found > shown && <span className="palette-heading-count">{`${shown} of ${found}`}</span>}
      </div>
      <ul className="palette-group">{children}</ul>
    </>
  );
}

function formatKeys(keys: string[] | undefined): string {
  if (!keys?.length) {
    return '';
  }
  return Array.from(new Set(keys.map((binding) => formatChord(binding)))).join(' ');
}

/**
 * A command that cannot run right now is shown dimmed rather than hidden: "Restart Kernel, greyed
 * out" answers the question that a missing row only raises.
 */
function isDisabled(command: ICommand): boolean {
  return command.isEnabled ? !command.isEnabled() : false;
}

function rowClass(selected: boolean, disabled: boolean): string {
  return ['palette-item', selected ? 'selected' : '', disabled ? 'disabled' : '']
    .filter(Boolean)
    .join(' ');
}

export default Palette;
