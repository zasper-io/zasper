import React, { useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { Icon, IconName } from '@/ide/icons';
import { baseName } from '@/paths';
import { problemsAtom, revealPositionAtom, Severity } from '@/store/languageServers';
import { useTabActions } from '@/store/tabActions';
import './ProblemsPanel.scss';

const ICONS: Record<Severity, IconName> = {
  error: 'circle-x',
  warning: 'triangle-alert',
  info: 'info',
  hint: 'info',
};

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2, hint: 3 };

/**
 * Every problem the language servers have reported (story 19), as one of the lists in the panel under the
 * editor so the message has the editor's width. A row opens its file at the problem.
 */
export default function ProblemsPanel() {
  const problems = useAtomValue(problemsAtom);
  const setReveal = useSetAtom(revealPositionAtom);
  const { openTab } = useTabActions();

  const rows = useMemo(
    () =>
      Object.entries(problems)
        .flatMap(([path, list]) => list.map((problem) => ({ path, ...problem })))
        .sort(
          (left, right) =>
            left.path.localeCompare(right.path) ||
            RANK[left.severity] - RANK[right.severity] ||
            left.line - right.line ||
            left.character - right.character
        ),
    [problems]
  );

  if (rows.length === 0) {
    return <p className="z-note dockList-empty">No problems have been reported.</p>;
  }

  return (
    <ul className="dockList problemsList" aria-label="Problems">
      {rows.map((row, index) => {
        const source = row.source && (row.code ? `${row.source} ${row.code}` : row.source);
        const where = `${row.path} ${row.line + 1}:${row.character + 1}`;
        return (
          <li key={`${row.path}:${index}`} className="panel-row problemRow">
            <button
              type="button"
              className="panel-row-name"
              title={row.message}
              onClick={() => {
                openTab({ name: baseName(row.path), path: row.path, type: 'file' });
                setReveal({ path: row.path, line: row.line, character: row.character });
              }}
            >
              <span className={`problemIcon is-${row.severity}`}>
                <Icon name={ICONS[row.severity]} size={12} />
              </span>
              <span className="panel-row-label">{row.message}</span>
              <span className="panel-row-meta">{[source, where].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
