import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'react-toastify';

import './SearchPanel.scss';
import '@/ide/editor/FindCard.scss';

import { apiErrorMessage, SearchFile, SearchLine, SearchRange } from '@/api';
import ConfirmDialog from '@/ide/ConfirmDialog';
import IconButton from '@/ide/IconButton';
import { baseName } from '@/paths';
import {
  countRanges,
  leftOutAtom,
  matchId,
  NO_SEARCH,
  revealMatchAtom,
  searchFocusRequestAtom,
  SearchOptions,
  searchOptionsAtom,
  searchRerunAtom,
  searchResultsAtom,
  shownLines,
  summaryText,
} from '@/store/projectSearch';
import { useTabActions } from '@/store/tabActions';
import { PanelProps } from '../types';
import SearchResultList from './SearchResultList';
import { notOpenCount, ReplaceReport, ReplaceTarget, useProjectReplace } from './useProjectReplace';
import { useProjectSearch } from './useProjectSearch';

type Toggle = 'caseSensitive' | 'wholeWord' | 'regexp';

const TOGGLES: { option: Toggle; text: string; label: string }[] = [
  { option: 'caseSensitive', text: 'Aa', label: 'Match case' },
  { option: 'wholeWord', text: 'ab', label: 'Whole word' },
  { option: 'regexp', text: '.*', label: 'Regular expression' },
];

function said(report: ReplaceReport): void {
  if (report.replaced > 0) {
    toast.success(
      `Replaced ${report.replaced} ${report.replaced === 1 ? 'match' : 'matches'} in ${report.files} ${
        report.files === 1 ? 'file' : 'files'
      }.`
    );
  }
  if (report.stale > 0) {
    toast.error(
      `${report.stale} ${report.stale === 1 ? 'match was' : 'matches were'} left alone: an open editor no longer had the text there.`
    );
  }
  report.failed.forEach((failure) => toast.error(`${failure.path}: ${failure.message}`));
}

/**
 * Search across the project: a panel in the sidebar, whose field, toggles and replace row
 * are the find card's stacked for its width, with the file filters folded behind `…`.
 */
export default function SearchPanel({ hidden }: PanelProps) {
  useProjectSearch();

  const [options, setOptions] = useAtom(searchOptionsAtom);
  const results = useAtomValue(searchResultsAtom);
  const [leftOut, setLeftOut] = useAtom(leftOutAtom);
  const setReveal = useSetAtom(revealMatchAtom);
  const setRerun = useSetAtom(searchRerunAtom);
  const focusRequest = useAtomValue(searchFocusRequestAtom);
  const { openTab, openSearchPreview } = useTabActions();
  const replace = useProjectReplace();

  const [filtersShown, setFiltersShown] = useState(false);
  const [confirming, setConfirming] = useState<ReplaceTarget[] | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusRequest > 0) {
      field.current?.focus();
      field.current?.select();
    }
  }, [focusRequest]);

  const change = (update: Partial<SearchOptions>) =>
    setOptions((current) => ({ ...current, ...update }));

  const shown = useMemo(() => {
    const files = results.files
      .map((file) => ({ file, lines: shownLines(file, leftOut) }))
      .filter((target) => target.lines.length > 0);
    return {
      targets: files,
      files: files.length,
      matches: files.reduce((total, target) => total + countRanges(target.lines), 0),
    };
  }, [results.files, leftOut]);

  const replaceable = shown.targets.reduce(
    (total, target) => total + countRanges(target.lines.filter((line) => line.output !== true)),
    0
  );

  const run = async (targets: ReplaceTarget[]) => {
    setBusy(true);
    try {
      said(await replace(targets));
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const open = (file: SearchFile, line: SearchLine, range: SearchRange) => {
    // While replacing, a row is a question about what the replace will do, which a file's diff answers.
    // A notebook's diff would be JSON, so a notebook row opens the notebook instead.
    if (options.replacing && file.kind === 'file') {
      openSearchPreview(file.path);
      return;
    }
    openTab({ name: baseName(file.path), path: file.path, type: file.kind });
    setReveal({
      path: file.path,
      line: line.line,
      from: range.from,
      to: range.to,
      cell: line.cell,
      output: line.output,
      search: options.pattern,
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      regexp: options.regexp,
    });
  };

  const summary = summaryText(results, shown);
  const unfinished = results.searching || results.summary?.capped === true;
  const notOpen = confirming === null ? 0 : notOpenCount(confirming);

  return (
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <div className="z-label">Search</div>
        <span className="search-head-actions">
          <IconButton
            icon="refresh-cw"
            label="Search again"
            disabled={options.pattern === ''}
            onClick={() => setRerun((count) => count + 1)}
          />
          <IconButton
            icon="x"
            label="Clear"
            onClick={() => {
              setOptions((current) => ({ ...NO_SEARCH, replacing: current.replacing }));
              field.current?.focus();
            }}
          />
        </span>
      </div>

      <div className="search-form">
        <IconButton
          icon={options.replacing ? 'chevron-down' : 'chevron-right'}
          label={options.replacing ? 'Hide replace' : 'Show replace'}
          expanded={options.replacing}
          onClick={() => change({ replacing: !options.replacing })}
        />
        <div className="search-fields">
          <div className="search-field-row">
            <input
              ref={field}
              className="z-field search-field"
              type="text"
              value={options.pattern}
              placeholder="Search"
              aria-label="Search"
              onChange={(event) => change({ pattern: event.target.value })}
            />
            {TOGGLES.map((toggle) => (
              <button
                key={toggle.option}
                type="button"
                className="z-icon-button find-toggle"
                aria-pressed={options[toggle.option]}
                aria-label={toggle.label}
                onClick={() => change({ [toggle.option]: !options[toggle.option] })}
              >
                {toggle.text}
              </button>
            ))}
          </div>
          {options.replacing && (
            <div className="search-field-row">
              <input
                className="z-field search-field"
                type="text"
                value={options.replace}
                placeholder="Replace"
                aria-label="Replace"
                onChange={(event) => change({ replace: event.target.value })}
              />
              <button
                type="button"
                className="z-button z-button-secondary search-replace-all"
                disabled={replaceable === 0 || unfinished || busy}
                onClick={() => setConfirming(shown.targets)}
              >
                Replace all
              </button>
            </div>
          )}
          <div className="search-field-row">
            {filtersShown && (
              <input
                className="z-field search-field"
                type="text"
                value={options.include}
                placeholder="Files to include, e.g. *.py, src/"
                aria-label="Files to include"
                onChange={(event) => change({ include: event.target.value })}
              />
            )}
            <IconButton
              icon="ellipsis"
              label={filtersShown ? 'Hide file filters' : 'Show file filters'}
              expanded={filtersShown}
              className="search-filters-toggle"
              onClick={() => setFiltersShown(!filtersShown)}
            />
          </div>
          {filtersShown && (
            <div className="search-field-row">
              <input
                className="z-field search-field"
                type="text"
                value={options.exclude}
                placeholder="Files to exclude"
                aria-label="Files to exclude"
                onChange={(event) => change({ exclude: event.target.value })}
              />
            </div>
          )}
        </div>
      </div>

      {summary !== '' && (
        <p
          className={results.error !== '' ? 'search-summary is-error' : 'search-summary'}
          role="status"
        >
          {summary}
        </p>
      )}

      <SearchResultList
        files={results.files}
        leftOut={leftOut}
        replacing={options.replacing}
        onOpen={open}
        onLeaveOutFile={(file) =>
          setLeftOut((current) => ({ ...current, files: [...current.files, file.path] }))
        }
        onLeaveOutMatch={(file, line, range) =>
          setLeftOut((current) => ({
            ...current,
            matches: [...current.matches, matchId(file.path, line, range)],
          }))
        }
        onReplaceFile={(file) => void run([{ file, lines: shownLines(file, leftOut) }])}
        onReplaceMatch={(file, line, range) =>
          void run([{ file, lines: [{ ...line, ranges: [range] }] }])
        }
      />

      {confirming !== null && (
        <ConfirmDialog
          title={`Replace ${replaceable} ${replaceable === 1 ? 'match' : 'matches'} in ${
            confirming.length
          } ${confirming.length === 1 ? 'file' : 'files'}?`}
          busy={busy}
          onCancel={() => setConfirming(null)}
          actions={
            <>
              <button
                type="button"
                className="z-button z-button-secondary"
                autoFocus
                disabled={busy}
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="z-button"
                disabled={busy}
                onClick={() => void run(confirming)}
              >
                Replace
              </button>
            </>
          }
        >
          <p>
            {notOpen === 0
              ? 'Every file is open, so each editor can undo its own.'
              : `${notOpen} of the files ${notOpen === 1 ? 'is' : 'are'} not open, so this cannot be undone from an editor.`}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
