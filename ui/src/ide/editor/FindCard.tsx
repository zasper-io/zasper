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

import { editorPulseAtom } from '@/store/editorRequests';
import FindControls, { FindOption } from './FindControls';
import { countLabel, countMatches, findQuery } from './findMatches';
import './FindCard.scss';

interface FindCardProps {
  view: EditorView;
  /** What the field starts with: the selection the reader had when they pressed ⌘F. */
  seed: string;
  /** Bumped by another ⌘F, which takes the field back rather than opening a second card. */
  focusRequest: number;
  /** The toggles to start with, when the search came from somewhere that had its own: the search panel. */
  seedOptions?: FindToggles | null;
  /** False when the card opens for a match pressed elsewhere, where the cursor belongs in the editor. */
  takeFocus?: boolean;
  onClose: () => void;
}

export type FindToggles = Record<FindOption, boolean>;

/**
 * Find and replace in the file editor, floating at the top right.
 *
 * Not a CodeMirror panel: one placed there is `position: sticky` inside `.cm-editor`, which is as tall
 * as the document rather than as the pane, so it lands part-way down the file. This is the app's own
 * card in the app's own layout, driven by the search commands the library exports — so nothing about
 * searching is reimplemented here, only where the controls are and what they are called. The controls
 * themselves are `FindControls`, shared with the notebook's card.
 */
export default function FindCard({
  view,
  seed,
  focusRequest,
  seedOptions = null,
  takeFocus = true,
  onClose,
}: FindCardProps) {
  const [search, setSearch] = useState(seed);
  const [replace, setReplace] = useState('');
  const [options, setOptions] = useState({
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
  });
  const field = useRef<HTMLInputElement>(null);
  // Bumped on every editor update, which is when a count can have changed: an edit adds or removes
  // matches, and a step moves which one the cursor is at.
  const pulse = useAtomValue(editorPulseAtom);

  const asked = useMemo(() => ({ search, replace, ...options }), [search, replace, options]);
  const query = useMemo(() => findQuery(asked), [asked]);

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
    if (takeFocus) {
      field.current?.focus();
      field.current?.select();
    }
    // Only on a request: the flag changing on its own is not a reason to move the focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  useEffect(() => {
    if (seed !== '') {
      setSearch(seed);
    }
    if (seedOptions !== null) {
      setOptions(seedOptions);
    }
    // The seed is taken when it is asked for, not whenever its object is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const onFieldKeyDown = (event: React.KeyboardEvent) => {
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
      <FindControls
        search={search}
        onSearch={setSearch}
        replace={replace}
        onReplace={setReplace}
        options={options}
        onToggle={(option: FindOption) =>
          setOptions((current) => ({ ...current, [option]: !current[option] }))
        }
        count={countLabel(asked, counted)}
        fieldRef={field}
        onFieldKeyDown={onFieldKeyDown}
        onPrevious={step(findPrevious)}
        onNext={step(findNext)}
        onReplaceOne={step(replaceNext)}
        onReplaceAll={step(replaceAll)}
        onSelectAll={step(selectMatches)}
        onClose={onClose}
      />
    </div>
  );
}
