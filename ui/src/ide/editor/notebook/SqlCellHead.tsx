import { useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';

import { DATAFRAMES } from '@/api';
import { Icon } from '@/ide/icons';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import { connectionsAtom } from '@/store/connections';
import { useTabActions } from '@/store/tabActions';
import { SqlCell } from './sqlCell';
import './SqlCellHead.scss';

const ENGINES: Record<string, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  duckdb: 'DuckDB',
  snowflake: 'Snowflake',
  bigquery: 'BigQuery',
  redshift: 'Redshift',
  databricks: 'Databricks',
  clickhouse: 'ClickHouse',
  url: 'SQLAlchemy',
};

export function engineName(type: string): string {
  return ENGINES[type] ?? type;
}

interface SqlCellHeadProps {
  cell: SqlCell;
  onChange: (changes: Partial<Pick<SqlCell, 'connection' | 'out'>>) => void;
}

/**
 * What a SQL cell runs on and what it makes, above its query: the connection, as a picker, and the
 * dataframe it assigns, as a name to edit. Both are its magic line, which the editor hides.
 */
export default function SqlCellHead({ cell, onChange }: SqlCellHeadProps) {
  const list = useAtomValue(connectionsAtom);
  const { openSettings } = useTabActions();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(cell.out);
  const picker = useRef<HTMLDivElement>(null);
  useDismissOnEscape(() => setOpen(false), open);
  useDismissOnPressOutside(picker, () => setOpen(false), open);
  useEffect(() => setName(cell.out), [cell.out]);

  const connections = list?.connections ?? [];
  const current = connections.find((c) => c.name === cell.connection);
  const isFrames = cell.connection === DATAFRAMES;
  const engine = isFrames ? 'DuckDB' : current ? engineName(current.type) : 'not set up';

  const commitName = () => {
    const next = name.trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(next) && next !== cell.out) {
      onChange({ out: next });
    } else {
      setName(cell.out);
    }
  };

  const choose = (connection: string) => {
    setOpen(false);
    if (connection !== cell.connection) {
      onChange({ connection });
    }
  };

  const group = (scope: 'project' | 'user', label: string) => {
    const rows = connections.filter((c) => c.scope === scope);
    if (rows.length === 0) {
      return null;
    }
    return (
      <>
        <li className="z-overlay-group z-label" role="presentation">
          {label}
        </li>
        {rows.map((c) => (
          <li
            key={`${c.scope}:${c.name}`}
            className={c.name === cell.connection ? 'panel-row is-selected' : 'panel-row'}
            role="none"
          >
            <button
              type="button"
              className="panel-row-name"
              role="menuitemradio"
              aria-checked={c.name === cell.connection}
              onClick={() => choose(c.name)}
            >
              <Icon name="database" size={12} />
              <span className="panel-row-label">{c.name}</span>
            </button>
            <span className="panel-row-meta">{engineName(c.type)}</span>
          </li>
        ))}
      </>
    );
  };

  return (
    <div className="sqlCell-bar">
      <span className="sqlCell-lang">SQL</span>
      <div className="sqlCell-pickerArea" ref={picker}>
        <button
          type="button"
          className={current || isFrames ? 'sqlCell-picker' : 'sqlCell-picker is-unknown'}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Run on ${cell.connection || 'no connection'}`}
          onClick={() => setOpen(!open)}
        >
          <Icon name={isFrames ? 'table' : 'database'} size={12} />
          {isFrames ? 'Dataframes' : cell.connection || 'Choose a connection'}
          <span className="sqlCell-engine">{engine}</span>
          <Icon name="chevron-down" size={12} />
        </button>
        {open && (
          <div className="z-overlay z-menu sqlCell-menu">
            <ul className="z-overlay-list" role="menu">
              {group('project', 'This project')}
              {group('user', 'Yours')}
              {connections.length > 0 && <li className="z-overlay-separator" role="separator" />}
              <li className={isFrames ? 'panel-row is-selected' : 'panel-row'} role="none">
                <button
                  type="button"
                  className="panel-row-name"
                  role="menuitemradio"
                  aria-checked={isFrames}
                  onClick={() => choose(DATAFRAMES)}
                >
                  <Icon name="table" size={12} />
                  <span className="panel-row-label">Dataframes</span>
                </button>
                <span className="panel-row-meta">DuckDB, in the kernel</span>
              </li>
              <li className="z-overlay-separator" role="separator" />
              <li className="panel-row" role="none">
                <button
                  type="button"
                  className="panel-row-name"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    openSettings();
                  }}
                >
                  <Icon name="plus" size={12} />
                  <span className="panel-row-label">Add a connection…</span>
                </button>
              </li>
            </ul>
          </div>
        )}
      </div>
      <span className="sqlCell-into">
        <Icon name="arrow-right" size={12} />
        <input
          className="z-field sqlCell-name"
          aria-label="Dataframe"
          value={name}
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitName();
              (event.target as HTMLInputElement).blur();
            } else if (event.key === 'Escape') {
              setName(cell.out);
            }
            event.stopPropagation();
          }}
        />
      </span>
    </div>
  );
}
