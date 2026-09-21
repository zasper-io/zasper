import React, { useEffect, useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import './Palette.scss';

import { ContentEntry } from '@/api';
import { formatChord } from '@/commands/keys';
import { Command } from '@/commands/types';
import { FileMark } from '@/ide/icons';
import { baseName } from '@/paths';
import { kindGlyph } from '@/lsp/symbols';
import { goToLineAtom } from '@/store/editorRequests';
import { revealPositionAtom } from '@/store/languageServers';
import { fileFormatsAtom } from '@/store/editorStatus';
import { folderOf, RecentFile, recentFilesAtom } from '@/store/recentFiles';
import { useTabActions } from '@/store/tabActions';
import { activeTabPathAtom, fileTabsAtom } from '@/store/tabState';
import { useFileMatches } from './useFileMatches';
import { SymbolMatch, useSymbolMatches } from './useSymbolMatches';

/** Typed at the start of the query, this drops the files and leaves the commands. */
export const COMMANDS_ONLY = '>';

/** The same for a line of the file in front: `:42`. Nothing else is a match for a number. */
export const LINES_ONLY = ':';

/** A symbol of the file in front, from its language server. */
export const SYMBOLS_IN_FILE = '@';

/** A symbol anywhere in the project, which every running server is asked for. */
export const SYMBOLS_IN_PROJECT = '#';

/**
 * Rows per section while both are on screen.
 *
 * There is no cap in commands-only mode: with nothing else in the list, the whole registry is the
 * answer to an empty query, and that browse-everything view is what the chord is for.
 */
const SHARED_CAP = 6;

/** One row of the list: the kinds are what Enter can do. */
type PaletteRow =
  | { kind: 'command'; command: Command }
  | { kind: 'file'; file: ContentEntry }
  | { kind: 'recent'; file: RecentFile }
  | { kind: 'line'; line: number }
  | { kind: 'symbol'; symbol: SymbolMatch };

interface PaletteProps {
  commands: Command[];
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
  // The first match is selected from the start, so typing a query and pressing Enter runs it.
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const { openTab } = useTabActions();

  const commandsOnly = query.startsWith(COMMANDS_ONLY);
  const linesOnly = query.startsWith(LINES_ONLY);
  // One field, one prefix per question, which is the rule `:42` set.
  const symbolsMode = query.startsWith(SYMBOLS_IN_FILE)
    ? 'file'
    : query.startsWith(SYMBOLS_IN_PROJECT)
      ? 'project'
      : null;
  const prefixed = commandsOnly || linesOnly || symbolsMode !== null;
  const typed = (prefixed ? query.slice(1) : query).trim();
  const needle = typed.toLowerCase();

  const activePath = useAtomValue(activeTabPathAtom);
  const openTabs = useAtomValue(fileTabsAtom);
  // Set by the file editor once it has read a text file, so this is also "is there one in front".
  const formats = useAtomValue(fileFormatsAtom);
  const recentFiles = useAtomValue(recentFilesAtom);
  const setGoToLine = useSetAtom(goToLineAtom);
  const setReveal = useSetAtom(revealPositionAtom);

  // A line only where there is an editor to take it, and only for a number: `:` on its own, or `:x`,
  // is a query nothing answers rather than a row that does nothing.
  const line =
    linesOnly && /^[1-9]\d*$/.test(typed) && formats[activePath] !== undefined
      ? Number(typed)
      : null;

  // As typed, not folded: the search endpoint decides how to match, and folding here would only make
  // the two ends disagree about what was asked.
  const files = useFileMatches(prefixed ? '' : typed);
  const symbols = useSymbolMatches(symbolsMode, typed, activePath);

  // Category as well as label, so "notebook" finds the notebook's commands whatever they are called.
  // An empty query lists everything only in commands-only mode: from the search box it means nothing
  // has been asked yet, and answering that with the first six commands in registration order is noise.
  const matches = useMemo(() => {
    if (linesOnly || symbolsMode !== null || (needle === '' && !commandsOnly)) {
      return [];
    }
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.category.toLowerCase().includes(needle)
    );
  }, [commands, needle, commandsOnly, linesOnly, symbolsMode]);

  /**
   * What the empty field answers, which until now was nothing: the files this project had open. One
   * that is still open is a tab away, so it is not offered here.
   */
  const recent = useMemo(
    () =>
      query === ''
        ? recentFiles.filter((file) => openTabs[file.path] === undefined).slice(0, SHARED_CAP)
        : [],
    [query, recentFiles, openTabs]
  );

  const shownCommands = commandsOnly ? matches : matches.slice(0, SHARED_CAP);
  const shownFiles = files.slice(0, SHARED_CAP);
  // Uncapped, as commands-only is: with nothing else in the list, the whole answer is the answer.
  const shownSymbols = symbols.slice(0, 40);

  const rows = useMemo<PaletteRow[]>(
    () => [
      ...(line === null ? [] : [{ kind: 'line', line } as PaletteRow]),
      ...shownCommands.map((command): PaletteRow => ({ kind: 'command', command })),
      ...shownSymbols.map((symbol): PaletteRow => ({ kind: 'symbol', symbol })),
      ...shownFiles.map((file): PaletteRow => ({ kind: 'file', file })),
      ...recent.map((file): PaletteRow => ({ kind: 'recent', file })),
    ],
    [line, shownCommands, shownSymbols, shownFiles, recent]
  );

  // Where each section starts in `rows`, which is what the arrow keys count in.
  const commandsFrom = line === null ? 0 : 1;
  const symbolsFrom = commandsFrom + shownCommands.length;
  const filesFrom = symbolsFrom + shownSymbols.length;
  const recentFrom = filesFrom + shownFiles.length;

  // The list shrinks as the query grows, so a selection made earlier can end up past its end. It
  // lands on -1, i.e. nothing selected, only when the query matches nothing at all.
  useEffect(() => {
    setSelectedIndex((index) => Math.min(Math.max(index, 0), rows.length - 1));
  }, [rows]);

  const activate = (row: PaletteRow) => {
    if (row.kind === 'line') {
      setGoToLine(row.line);
    } else if (row.kind === 'symbol') {
      openTab({ name: baseName(row.symbol.path), path: row.symbol.path, type: 'file' });
      setReveal({
        path: row.symbol.path,
        line: row.symbol.line,
        character: row.symbol.character,
      });
    } else if (row.kind === 'recent') {
      openTab({ name: row.file.name, path: row.file.path, type: row.file.type });
    } else if (row.kind === 'file') {
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
    <div className="z-overlay palette">
      <input
        type="text"
        className="palette-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        // The palette covers the button that opened it, so without this the user would be looking at
        // an input that needs a second click before it takes a keystroke.
        autoFocus
        placeholder="Search files, > for commands, @ for symbols"
      />
      {/* One scrolling box over both sections, so a long command list does not push the files out
          of reach of the wheel. Empty when nothing matches, which .palette-list:not(:empty) reads. */}
      <div className="palette-list">
        {line !== null && (
          <Section title="Editor" shown={1} found={1}>
            <li
              className={rowClass(selectedIndex === 0, false)}
              onClick={() => activate({ kind: 'line', line })}
            >
              <span className="panel-row-label">Go to line {line}</span>
              {/* Which file it is a line of: the palette is over the window, not over the editor. */}
              <span className="panel-row-meta">{openTabs[activePath]?.name ?? ''}</span>
            </li>
          </Section>
        )}
        <Section title="Commands" shown={shownCommands.length} found={matches.length}>
          {shownCommands.map((command, index) => (
            <li
              key={command.id}
              className={rowClass(selectedIndex === commandsFrom + index, isDisabled(command))}
              onClick={() => activate({ kind: 'command', command })}
            >
              <span className="panel-row-label">{command.label}</span>
              <span className="panel-row-meta">{command.description ?? command.category}</span>
              {/* Rendered from the same binding strings the keyboard dispatches, so the two cannot
                  disagree. Deduped: off mac, `Mod-` and `Ctrl-` spellings collapse to one chord. */}
              <span className="panel-row-keys">{formatKeys(command.keys)}</span>
            </li>
          ))}
        </Section>
        <Section
          title={symbolsMode === 'project' ? 'Symbols in the project' : 'Symbols in this file'}
          shown={shownSymbols.length}
          found={symbols.length}
        >
          {shownSymbols.map((symbol, index) => (
            <li
              key={`${symbol.path}:${symbol.line}:${symbol.character}:${symbol.name}`}
              className={rowClass(selectedIndex === symbolsFrom + index, false)}
              onClick={() => activate({ kind: 'symbol', symbol })}
            >
              <span className="panel-row-name">
                <span className="palette-kind">{kindGlyph(symbol.kind)}</span>
                <span className="panel-row-label">{symbol.name}</span>
                <span className="panel-row-meta">{symbol.detail ?? ''}</span>
              </span>
            </li>
          ))}
        </Section>
        <Section title="Files" shown={shownFiles.length} found={files.length}>
          {shownFiles.map((file, index) => (
            <li
              key={file.path}
              className={rowClass(selectedIndex === filesFrom + index, false)}
              onClick={() => activate({ kind: 'file', file })}
            >
              <span className="panel-row-label">{file.name}</span>
              {/* Where it is, and nothing when that is nowhere: a file in the project root has a
                  path equal to its name, and printing both spelled every such row out twice. */}
              <span className="panel-row-meta">{file.path === file.name ? '' : file.path}</span>
            </li>
          ))}
        </Section>
        <Section title="Recent" shown={recent.length} found={recentFiles.length}>
          {recent.map((file, index) => (
            <li
              key={file.path}
              className={rowClass(selectedIndex === recentFrom + index, false)}
              onClick={() => activate({ kind: 'recent', file })}
            >
              {/* A mark here and not on a file match: these rows are a list to read down rather than
                  the answer to something that was typed. Inside the name, as on the Launcher, because
                  the row centres its children and a 9px mark centred beside 13px text sits 2px high. */}
              <span className="panel-row-name">
                <FileMark name={file.name} />
                <span className="panel-row-label">{file.name}</span>
                <span className="panel-row-meta">{folderOf(file)}</span>
              </span>
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
      <div className="z-overlay-group z-label">
        <span>{title}</span>
        {found > shown && <span className="panel-section-count">{`${shown} of ${found}`}</span>}
      </div>
      <ul className="z-overlay-list">{children}</ul>
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
function isDisabled(command: Command): boolean {
  return command.isEnabled ? !command.isEnabled() : false;
}

// `.panel-row` and its two menu states, which is the whole of what a palette row is now: `.palette-item`
// was a 26px row in `--z-fg-on-chrome`, `.selected` and `:hover` were one colour, and `.disabled` said
// what `.is-disabled` says. `is-selected` is the keyboard's row and is a stronger fill than hover, so
// moving the mouse no longer looks like it moved the selection.
function rowClass(selected: boolean, disabled: boolean): string {
  return ['panel-row', selected ? 'is-selected' : '', disabled ? 'is-disabled' : '']
    .filter(Boolean)
    .join(' ');
}

export default Palette;
