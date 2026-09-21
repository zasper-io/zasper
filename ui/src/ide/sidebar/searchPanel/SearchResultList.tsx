import React, { useState } from 'react';

import { SearchFile, SearchLine, SearchRange } from '@/api';
import FileMark from '@/ide/icons/FileMark';
import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { LeftOut, rowPieces, shownLines } from '@/store/projectSearch';

interface SearchResultListProps {
  files: SearchFile[];
  leftOut: LeftOut;
  replacing: boolean;
  onOpen: (file: SearchFile, line: SearchLine, range: SearchRange) => void;
  onLeaveOutFile: (file: SearchFile) => void;
  onLeaveOutMatch: (file: SearchFile, line: SearchLine, range: SearchRange) => void;
  onReplaceFile: (file: SearchFile) => void;
  onReplaceMatch: (file: SearchFile, line: SearchLine, range: SearchRange) => void;
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function stop(action: () => void) {
  return (event: React.MouseEvent) => {
    event.stopPropagation();
    action();
  };
}

/** Where a notebook row is, which says as much about the row as its text: `cell 3`, or `output 3`. */
function whereIn(line: SearchLine): string {
  if (line.cell === undefined) {
    return '';
  }
  return `${line.output === true ? 'output' : 'cell'} ${line.cell + 1}`;
}

/**
 * The results, grouped by file: a row per file with its count, and under it a row per
 * matching line, cut to start near the match. While replacing, each match shows what it will read.
 */
export default function SearchResultList(props: SearchResultListProps) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  const toggle = (path: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });

  return (
    <ul className="search-results" aria-label="Search results">
      {props.files.map((file) => {
        const lines = shownLines(file, props.leftOut);
        if (lines.length === 0) {
          return null;
        }
        const open = !folded.has(file.path);
        const count = lines.reduce((total, line) => total + line.ranges.length, 0);
        const inOutputs = lines
          .filter((line) => line.output === true)
          .reduce((total, line) => total + line.ranges.length, 0);
        const folder = folderOf(file.path);

        return (
          <li key={file.path}>
            <div
              className="panel-row search-file"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              title={file.path}
              onClick={() => toggle(file.path)}
              onKeyDown={(event) => event.key === 'Enter' && toggle(file.path)}
            >
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
              <FileMark name={file.path} />
              <span className="panel-row-name">
                <span className="panel-row-label">{baseOf(file.path)}</span>
                {folder !== '' && <span className="panel-row-meta">{folder}</span>}
              </span>
              <span className="panel-section-count">{count}</span>
              <span className="panel-row-actions search-row-actions">
                {props.replacing && (
                  <IconButton
                    icon="check"
                    label="Replace in this file"
                    onClick={stop(() => props.onReplaceFile(file))}
                  />
                )}
                <IconButton
                  icon="x"
                  label="Leave this file out"
                  onClick={stop(() => props.onLeaveOutFile(file))}
                />
              </span>
            </div>
            {open && (
              <ul>
                {lines.flatMap((line) => {
                  const { cut, pieces } = rowPieces(line);
                  const where = whereIn(line);
                  // One row per line: a line with two matches is one place to go, and opens at the first.
                  return [
                    <li
                      key={`${line.cell ?? ''}:${line.output === true}:${line.line}`}
                      className={
                        line.output === true
                          ? 'panel-row search-match is-output'
                          : 'panel-row search-match'
                      }
                      role="button"
                      tabIndex={0}
                      onClick={() => props.onOpen(file, line, line.ranges[0])}
                      onKeyDown={(event) =>
                        event.key === 'Enter' && props.onOpen(file, line, line.ranges[0])
                      }
                    >
                      <span className="panel-row-name">
                        <span className="panel-row-label">
                          {cut && '…'}
                          {pieces.map((piece, index) => {
                            if (piece.range === undefined) {
                              return <React.Fragment key={index}>{piece.text}</React.Fragment>;
                            }
                            if (props.replacing && line.output !== true) {
                              return (
                                <React.Fragment key={index}>
                                  <del>{piece.text}</del>
                                  <ins>{piece.range.replacement ?? ''}</ins>
                                </React.Fragment>
                              );
                            }
                            return <mark key={index}>{piece.text}</mark>;
                          })}
                        </span>
                        {where !== '' && <span className="panel-row-meta">{where}</span>}
                      </span>
                      <span className="panel-row-actions search-row-actions">
                        {props.replacing && line.output !== true && (
                          <IconButton
                            icon="check"
                            label="Replace"
                            onClick={stop(() => props.onReplaceMatch(file, line, line.ranges[0]))}
                          />
                        )}
                        <IconButton
                          icon="x"
                          label="Leave this out"
                          onClick={stop(() => props.onLeaveOutMatch(file, line, line.ranges[0]))}
                        />
                      </span>
                    </li>,
                  ];
                })}
                {props.replacing && inOutputs > 0 && (
                  <li className="search-note">
                    {inOutputs === 1
                      ? '1 of these is in an output, and cannot be replaced.'
                      : `${inOutputs} of these are in outputs, and cannot be replaced.`}
                  </li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
