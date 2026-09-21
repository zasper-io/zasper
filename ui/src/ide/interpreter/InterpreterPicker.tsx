import React, { useEffect, useMemo, useRef, useState } from 'react';

import './InterpreterPicker.scss';

import { usePythonInterpreter } from '@/store/interpreters';

interface InterpreterPickerProps {
  /** `palette` alone in the topbar; with `languagePicker` over its status bar item. */
  className: string;
  title: string;
  placeholder: string;
  onClose: () => void;
}

interface Row {
  /** '' is automatic. */
  path: string;
  label: string;
  meta: string;
}

/**
 * The Pythons a file can be run with, as a field over a list: the language picker's shape, opened from
 * the status bar and from the palette's Select Python Interpreter.
 */
export default function InterpreterPicker({
  className,
  title,
  placeholder,
  onClose,
}: InterpreterPickerProps) {
  const [choice, choose] = usePythonInterpreter();
  const [query, setQuery] = useState('');

  const rows = useMemo<Row[]>(() => {
    if (choice === null) {
      return [];
    }
    const own = choice.interpreters.find((python) => python.executable === choice.automatic);
    return [
      {
        path: '',
        label: 'Automatic',
        meta: own ? `this project’s ${own.where} · ${own.version}` : 'python3 from the shell',
      },
      ...choice.interpreters.map((python) => ({
        path: python.executable,
        label: `Python ${python.version}`,
        meta: `${python.where} · ${python.executable}`,
      })),
    ];
  }, [choice]);

  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => `${row.label} ${row.meta}`.toLowerCase().includes(needle));
  const current = shown.findIndex((row) => row.path === (choice?.chosen ?? ''));
  const [selected, setSelected] = useState(Math.max(current, 0));

  // The list shrinks as the query grows, so a selection made earlier can end up past its end. Not on
  // opening, where the row in use is the one to start on.
  const typedBefore = useRef(needle);
  useEffect(() => {
    if (typedBefore.current !== needle) {
      typedBefore.current = needle;
      setSelected(0);
    }
  }, [needle]);

  const pick = (row: Row) => {
    if (row.path !== choice?.chosen) {
      choose(row.path);
    }
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      setSelected((index) => Math.min(index + 1, shown.length - 1));
    } else if (event.key === 'ArrowUp') {
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && shown[selected] !== undefined) {
      pick(shown[selected]);
    }
  };

  return (
    <div className={`z-overlay ${className} interpreterPicker`}>
      <input
        type="text"
        className="palette-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <div className="palette-list">
        <div className="z-overlay-group z-label">
          <span>{title}</span>
          <span className="panel-section-count">{shown.length}</span>
        </div>
        <ul className="z-overlay-list">
          {shown.map((row, index) => (
            <li
              key={row.path}
              className={index === selected ? 'panel-row is-selected' : 'panel-row'}
              aria-current={row.path === (choice?.chosen ?? '')}
              onClick={() => pick(row)}
            >
              <span className="panel-row-label">{row.label}</span>
              <span className="panel-row-meta">{row.meta}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
