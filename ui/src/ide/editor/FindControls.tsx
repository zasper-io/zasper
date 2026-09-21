import React, { ReactNode, RefObject } from 'react';

import IconButton from '@/ide/IconButton';

/** Which of the three options a toggle is for. */
export type FindOption = 'caseSensitive' | 'wholeWord' | 'regexp';

export interface FindControlsProps {
  search: string;
  onSearch: (value: string) => void;
  replace: string;
  onReplace: (value: string) => void;
  options: Record<FindOption, boolean>;
  onToggle: (option: FindOption) => void;
  /** What the card says beside the field: a position, a refusal, or nothing at all. */
  count: string;
  fieldRef: RefObject<HTMLInputElement>;
  onFieldKeyDown: (event: React.KeyboardEvent) => void;
  onPrevious: () => void;
  onNext: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  /** Absent where there is nothing to select: a notebook's matches live in many documents. */
  onSelectAll?: () => void;
  onClose: () => void;
  /** Rows only one of the two editors has — a notebook's filters, and what its count is hiding. */
  children?: ReactNode;
}

/**
 * The controls of the find card, which the file editor and the notebook share.
 *
 * Presentational on purpose: the two drive entirely different searches — one CodeMirror view against
 * fifty of them — and the one thing they must not do is drift apart on screen, so the
 * shape is written once.
 */
export default function FindControls(props: FindControlsProps) {
  const [replacing, setReplacing] = React.useState(false);

  return (
    <>
      <input
        ref={props.fieldRef}
        className="z-field find-field"
        type="text"
        value={props.search}
        placeholder="Find"
        aria-label="Find"
        onChange={(event) => props.onSearch(event.target.value)}
        onKeyDown={props.onFieldKeyDown}
      />
      <span className="find-count">{props.count}</span>
      <span className="find-actions">
        <IconButton icon="chevron-up" label="Previous match" onClick={props.onPrevious} />
        <IconButton icon="chevron-down" label="Next match" onClick={props.onNext} />
        {/* Letters rather than words, because all three have to fit beside the field: this is the
            shape the drawing settled. `aria-pressed` is the app's own state for an icon button. */}
        <button
          type="button"
          className="z-icon-button find-toggle"
          aria-pressed={props.options.caseSensitive}
          aria-label="Match case"
          onClick={() => props.onToggle('caseSensitive')}
        >
          Aa
        </button>
        <button
          type="button"
          className="z-icon-button find-toggle"
          aria-pressed={props.options.wholeWord}
          aria-label="Whole word"
          onClick={() => props.onToggle('wholeWord')}
        >
          ab
        </button>
        <button
          type="button"
          className="z-icon-button find-toggle"
          aria-pressed={props.options.regexp}
          aria-label="Regular expression"
          onClick={() => props.onToggle('regexp')}
        >
          .*
        </button>
        <IconButton
          icon="chevron-right"
          label={replacing ? 'Hide replace' : 'Show replace'}
          pressed={replacing}
          onClick={() => setReplacing(!replacing)}
        />
        <IconButton icon="x" label="Close find" onClick={props.onClose} />
      </span>
      {replacing && (
        <span className="find-card-row">
          <input
            className="z-field find-field"
            type="text"
            value={props.replace}
            placeholder="Replace"
            aria-label="Replace"
            onChange={(event) => props.onReplace(event.target.value)}
            onKeyDown={props.onFieldKeyDown}
          />
          <button
            type="button"
            className="z-button z-button-secondary"
            onClick={props.onReplaceOne}
          >
            Replace
          </button>
          <button
            type="button"
            className="z-button z-button-secondary"
            onClick={props.onReplaceAll}
          >
            Replace all
          </button>
          {props.onSelectAll !== undefined && (
            <button
              type="button"
              className="z-button z-button-secondary"
              onClick={props.onSelectAll}
            >
              Select all
            </button>
          )}
        </span>
      )}
      {props.children}
    </>
  );
}
