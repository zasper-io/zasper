import React, { useEffect, useRef } from 'react';

import FindControls, { FindOption } from '../FindControls';
import { NotebookFind } from './useNotebookFind';
import '../FindCard.scss';
import './NotebookFindCard.scss';

interface NotebookFindCardProps {
  find: NotebookFind;
  /** Bumped by another ⌘F, which takes the field back rather than opening a second card. */
  focusRequest: number;
  /** False when the card opens for a match pressed in the search panel, which puts the cursor in a cell. */
  takeFocus?: boolean;
  onClose: () => void;
}

/** What the card says beside the field: where the reader is among the matches, or why there are none. */
export function notebookCountLabel(find: NotebookFind): string {
  if (find.options.search === '') {
    return '';
  }
  if (find.broken) {
    return 'Bad pattern';
  }
  if (find.matches.length === 0) {
    return 'No results';
  }
  // Before the first step there is no match the reader is on, and the first one is where next goes.
  return `${find.current === 0 ? 1 : find.current} of ${find.matches.length}`;
}

/** What the count is not saying: matches nobody can replace, and cells nobody searched. */
export function notebookFindNote(find: NotebookFind): string {
  const said: string[] = [];
  if (find.options.search !== '' && find.inOutputs > 0) {
    said.push(
      find.inOutputs === 1
        ? '1 of these is in an output, and cannot be replaced.'
        : `${find.inOutputs} of these are in outputs, and cannot be replaced.`
    );
  }
  if (find.skippedRendered > 0) {
    said.push(
      find.skippedRendered === 1
        ? '1 rendered markdown cell was not searched.'
        : `${find.skippedRendered} rendered markdown cells were not searched.`
    );
  }
  return said.join(' ');
}

/**
 * Find and replace across a notebook (story 17), floating under the toolbar over the first cell.
 *
 * The controls are the file editor's, shared so the two cannot drift apart; what a notebook adds is
 * the filter for outputs and the line that says what the count is hiding. Replace never touches an
 * output, and a rendered markdown cell is left rendered — both settled in the story, and both said
 * out loud here rather than left for the reader to discover.
 */
export default function NotebookFindCard({
  find,
  focusRequest,
  takeFocus = true,
  onClose,
}: NotebookFindCardProps) {
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (takeFocus) {
      field.current?.focus();
      field.current?.select();
    }
    // Only on a request: the flag changing on its own is not a reason to move the focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const onFieldKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        find.previous();
      } else {
        find.next();
      }
      // The match is in a cell, and the reader is still typing in the card.
      field.current?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const note = notebookFindNote(find);

  return (
    <div className="z-overlay find-card notebook-find">
      <FindControls
        search={find.options.search}
        onSearch={(search) => find.setOptions({ search })}
        replace={find.options.replace}
        onReplace={(replace) => find.setOptions({ replace })}
        options={{
          caseSensitive: find.options.caseSensitive,
          wholeWord: find.options.wholeWord,
          regexp: find.options.regexp,
        }}
        onToggle={(option: FindOption) => find.setOptions({ [option]: !find.options[option] })}
        count={notebookCountLabel(find)}
        fieldRef={field}
        onFieldKeyDown={onFieldKeyDown}
        onPrevious={find.previous}
        onNext={find.next}
        onReplaceOne={find.replaceCurrent}
        onReplaceAll={find.replaceAll}
        onClose={onClose}
      >
        <span className="find-filters">
          <label className="z-checkbox">
            <input
              type="checkbox"
              checked={find.options.outputs}
              onChange={(event) => find.setOptions({ outputs: event.target.checked })}
            />
            Cell outputs
          </label>
        </span>
        {note !== '' && <span className="find-note">{note}</span>}
      </FindControls>
    </div>
  );
}
