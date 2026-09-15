import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';

import { LANGUAGE_CHOICES, languageNameFor, PLAIN_TEXT } from '@/ide/editor/language';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import { chosenLanguagesAtom } from '@/store/editorStatus';

/** Rows at once. There are 180-odd languages, so the field is how the rest are reached. */
const SHOWN = 40;

interface LanguageStatusProps {
  path: string;
  /** The file's own name, which is what a language is guessed from. */
  fileName: string;
}

/**
 * What the file in front is read as, and the picker that changes it.
 *
 * A field over a list of rows is the palette's shape, and the app has it already — the alternative was
 * a menu of 180 rows with nothing to narrow it. The choice is this file's, for as long as it is open:
 * `notes` holding SQL is SQL because someone said so, and nothing on disk records that.
 */
export default function LanguageStatus({ path, fileName }: LanguageStatusProps) {
  const chosenAtom = useMemo(
    () => selectAtom(chosenLanguagesAtom, (chosen) => chosen[path]),
    [path]
  );
  const chosen = useAtomValue(chosenAtom);
  const setChosen = useSetAtom(chosenLanguagesAtom);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const picker = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  useDismissOnEscape(close, open);
  useDismissOnPressOutside(picker, close, open);

  const current = chosen ?? languageNameFor(fileName) ?? PLAIN_TEXT;
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      LANGUAGE_CHOICES.filter(
        (choice) => choice.name.toLowerCase().includes(needle) || choice.extension.includes(needle)
      ),
    [needle]
  );
  const shown = matches.slice(0, SHOWN);

  // The list shrinks as the query grows, so a selection made earlier can end up past its end.
  useEffect(() => {
    setSelected(0);
  }, [needle]);

  const choose = (name: string) => {
    setChosen((languages) => ({ ...languages, [path]: name }));
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      setSelected((index) => Math.min(index + 1, shown.length - 1));
    } else if (event.key === 'ArrowUp') {
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && shown[selected] !== undefined) {
      choose(shown[selected].name);
    }
  };

  return (
    <div className="statusItem statusPicker" ref={picker}>
      <button
        type="button"
        className="statusButton"
        aria-label={`Language: ${current}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {current}
      </button>
      {open && (
        <div className="z-overlay palette languagePicker">
          <input
            type="text"
            className="palette-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            // The picker covers nothing, but a field nobody has clicked into takes no keystroke.
            autoFocus
            placeholder="Filter languages"
            aria-label="Filter languages"
          />
          <div className="palette-list">
            <div className="z-overlay-group z-label">
              <span>Language</span>
              {matches.length > shown.length && (
                <span className="panel-section-count">{`${shown.length} of ${matches.length}`}</span>
              )}
            </div>
            {shown.length === 0 ? (
              <p className="z-note languagePicker-empty">No language matches “{query.trim()}”.</p>
            ) : (
              <ul className="z-overlay-list">
                {shown.map((choice, index) => (
                  <li
                    key={choice.name}
                    className={index === selected ? 'panel-row is-selected' : 'panel-row'}
                    onClick={() => choose(choice.name)}
                  >
                    <span className="panel-row-label">{choice.name}</span>
                    {/* Which of a family it is: Markdown and MDX, SQL and PLSQL, read alike. */}
                    <span className="panel-row-meta">{choice.extension}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
