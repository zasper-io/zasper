import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
  SearchQuery,
} from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { useAtomValue } from 'jotai';

import IconButton from '@/ide/IconButton';
import { editorPulseAtom } from '@/store/editorRequests';
import { countLabel, countMatches, findQuery } from './findMatches';
import './FindCard.scss';

interface FindCardProps {
  view: EditorView;
  /** What the field starts with: the selection the reader had when they pressed ⌘F. */
  seed: string;
  /** Bumped by another ⌘F, which takes the field back rather than opening a second card. */
  focusRequest: number;
  onClose: () => void;
}

/**
 * Find and replace, floating at the top right of the editor (story 15).
 *
 * Not a CodeMirror panel: one placed there is `position: sticky` inside `.cm-editor`, which is as tall
 * as the document rather than as the pane, so it lands part-way down the file. This is the app's own
 * card in the app's own layout, driven by the search commands the library exports — so nothing about
 * searching is reimplemented here, only where the controls are and what they are called.
 */
export default function FindCard({ view, seed, focusRequest, onClose }: FindCardProps) {
  const [search, setSearch] = useState(seed);
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // Bumped on every editor update, which is when a count can have changed: an edit adds or removes
  // matches, and a step moves which one the cursor is at.
  const pulse = useAtomValue(editorPulseAtom);

  const options = useMemo(
    () => ({ search, replace, caseSensitive, wholeWord, regexp }),
    [search, replace, caseSensitive, wholeWord, regexp]
  );
  const query = useMemo(() => findQuery(options), [options]);

  // What CodeMirror looks for: this is what highlights every match and what the commands act on.
  useEffect(() => {
    view.dispatch({ effects: setSearchQuery.of(query ?? new SearchQuery({ search: '' })) });
  }, [view, query]);

  // Nothing is looked for once the card is gone, or every match would stay marked behind it.
  useEffect(
    () => () => {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
    },
    [view]
  );

  // The field takes the focus when the card opens and on every ⌘F after it, with its text selected so
  // the next thing typed replaces the query rather than extending it.
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [focusRequest]);

  useEffect(() => {
    if (seed !== '') {
      setSearch(seed);
    }
  }, [seed, focusRequest]);

  const counted = useMemo(() => {
    // Read only to depend on: a change to it means the document or the cursor moved, which is the
    // whole reason to count again.
    void pulse;
    return query === null ? null : countMatches(view.state, query);
  }, [view, query, pulse]);

  const step = (command: (view: EditorView) => boolean) => () => {
    command(view);
    // The match is in the editor, and the reader is still typing in the card.
    field.current?.focus();
  };

  const onFieldKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(view);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="z-overlay find-card">
      <input
        ref={field}
        className="z-field find-field"
        type="text"
        value={search}
        placeholder="Find"
        aria-label="Find"
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={onFieldKey}
      />
      <span className="find-count">{countLabel(options, counted)}</span>
      <span className="find-actions">
        <IconButton icon="chevron-up" label="Previous match" onClick={step(findPrevious)} />
        <IconButton icon="chevron-down" label="Next match" onClick={step(findNext)} />
        {/* Letters rather than words, because all three have to fit beside the field: this is the
            shape the drawing settled. `aria-pressed` is the app's own state for an icon button. */}
        <button
          type="button"
          className="z-icon-button find-toggle"
          aria-pressed={caseSensitive}
          aria-label="Match case"
          onClick={() => setCaseSensitive(!caseSensitive)}
        >
          Aa
        </button>
        <button
          type="button"
          className="z-icon-button find-toggle"
          aria-pressed={wholeWord}
          aria-label="Whole word"
          onClick={() => setWholeWord(!wholeWord)}
        >
          ab
        </button>
        <button
          type="button"
          className="z-icon-button find-toggle"
          aria-pressed={regexp}
          aria-label="Regular expression"
          onClick={() => setRegexp(!regexp)}
        >
          .*
        </button>
        <IconButton
          icon="chevron-right"
          label={replacing ? 'Hide replace' : 'Show replace'}
          pressed={replacing}
          onClick={() => setReplacing(!replacing)}
        />
        <IconButton icon="x" label="Close find" onClick={onClose} />
      </span>
      {replacing && (
        <span className="find-card-row">
          <input
            className="z-field find-field"
            type="text"
            value={replace}
            placeholder="Replace"
            aria-label="Replace"
            onChange={(event) => setReplace(event.target.value)}
            onKeyDown={onFieldKey}
          />
          <button type="button" className="z-button z-button-secondary" onClick={step(replaceNext)}>
            Replace
          </button>
          <button type="button" className="z-button z-button-secondary" onClick={step(replaceAll)}>
            Replace all
          </button>
          <button
            type="button"
            className="z-button z-button-secondary"
            onClick={step(selectMatches)}
          >
            Select all
          </button>
        </span>
      )}
    </div>
  );
}
