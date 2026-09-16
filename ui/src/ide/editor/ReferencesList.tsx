import React, { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { Icon } from '@/ide/icons';
import FileMark from '@/ide/icons/FileMark';
import { baseName, parentDirOf } from '@/paths';
import { revealPositionAtom } from '@/store/languageServers';
import { ReferenceFile, ReferencePlace, referencesAtom } from '@/store/references';
import { useTabActions } from '@/store/tabActions';
import './ReferencesList.scss';

/** The line with the name marked in it, and the indentation dropped so short rows read together. */
function pieces(place: ReferencePlace): { lead: string; mark: string; tail: string } {
  const indent = /^\s*/.exec(place.text)?.[0].length ?? 0;
  const from = Math.max(place.character, indent);
  const to = Math.max(from, place.endCharacter);
  return {
    lead: place.text.slice(indent, from),
    mark: place.text.slice(from, to),
    tail: place.text.slice(to),
  };
}

/**
 * Every place a name is used (story 20), in the panel under the editor. The rows are the project search's
 * — a file, and the lines found in it — because a place a name is used is read the same way as a place a
 * word was found. The row that defines the name says so.
 */
export default function ReferencesList() {
  const references = useAtomValue(referencesAtom);
  const setReveal = useSetAtom(revealPositionAtom);
  const { openTab } = useTabActions();
  const [folded, setFolded] = useState<Set<string>>(new Set());

  if (references === null) {
    return (
      <p className="z-note dockList-empty">
        Nothing has been asked for yet. <kbd>⇧F12</kbd> on a name lists every place it is used.
      </p>
    );
  }
  if (references.state === 'asking') {
    return <p className="z-note dockList-empty">Asking about {references.symbol}…</p>;
  }
  if (references.state === 'unanswered') {
    return (
      <p className="z-note dockList-empty">
        {references.message ?? 'No language server answered for this file.'}
      </p>
    );
  }
  if (references.total === 0) {
    return (
      <p className="z-note dockList-empty">
        <strong>{references.symbol}</strong> is not used anywhere the server can see.
      </p>
    );
  }

  const toggle = (path: string) =>
    setFolded((open) => {
      const next = new Set(open);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });

  const go = (file: ReferenceFile, place: ReferencePlace) => {
    openTab({ name: baseName(file.path), path: file.path, type: 'file' });
    setReveal({ path: file.path, line: place.line, character: place.character });
  };

  return (
    <ul className="dockList referencesList" aria-label="References">
      <li className="referencesList-question">
        <strong>{references.symbol}</strong>
        {` · ${references.total} ${references.total === 1 ? 'use' : 'uses'} in ${
          references.files.length
        } ${references.files.length === 1 ? 'file' : 'files'}`}
      </li>
      {references.files.map((file) => {
        const open = !folded.has(file.path);
        const folder = parentDirOf(file.path);
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
                <span className="panel-row-label">{baseName(file.path)}</span>
                {folder !== '' && <span className="panel-row-meta">{folder}</span>}
              </span>
              <span className="panel-section-count">{file.places.length}</span>
            </div>
            {open && (
              <ul>
                {file.places.map((place) => {
                  const { lead, mark, tail } = pieces(place);
                  const where = `${place.line + 1}:${place.character + 1}`;
                  return (
                    <li
                      key={`${place.line}:${place.character}`}
                      className="panel-row search-match"
                      role="button"
                      tabIndex={0}
                      onClick={() => go(file, place)}
                      onKeyDown={(event) => event.key === 'Enter' && go(file, place)}
                    >
                      <span className="panel-row-name">
                        <span className="panel-row-label">
                          {lead}
                          <mark>{mark}</mark>
                          {tail}
                        </span>
                        <span className="panel-row-meta">
                          {place.definition ? `${where} · definition` : where}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
