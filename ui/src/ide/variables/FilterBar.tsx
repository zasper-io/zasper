import { FormEvent, useEffect, useState } from 'react';

import { ColumnKind, FilterOp, RowFilter } from '@/api';
import IconButton from '@/ide/IconButton';
import { describeFilter, OP_LABELS, opsFor, takesValue } from './filters';

interface FilterBarProps {
  columns: { name: string; kind: ColumnKind }[];
  filters: RowFilter[];
  onChange: (filters: RowFilter[]) => void;
  /** A column a header asked to filter on, which opens the editor on it. */
  request: { column: number; at: number } | null;
  /** Told when the form opens and closes, so a grid that hides an empty bar can keep it up meanwhile. */
  onFormChange?: (open: boolean) => void;
  /** Whether to offer "Add filter" while the form is closed. */
  addButton?: boolean;
}

/** The conditions a table's rows must meet, as chips, and the form that adds one. */
export default function FilterBar(props: FilterBarProps) {
  const { columns, filters, onChange, request, onFormChange, addButton = true } = props;
  const [editing, setEditingState] = useState(false);
  const setEditing = (open: boolean) => {
    setEditingState(open);
    onFormChange?.(open);
  };
  const [column, setColumn] = useState(0);
  const [op, setOp] = useState<FilterOp>(opsFor(columns[0]?.kind ?? 'other')[0]);
  const [value, setValue] = useState('');

  const begin = (at: number) => {
    setColumn(at);
    setOp(opsFor(columns[at]?.kind ?? 'other')[0]);
    setValue('');
    setEditing(true);
  };

  useEffect(() => {
    if (request !== null) {
      begin(request.column);
    }
    // Only a new request opens the editor; `columns` changing under it does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onChange([...filters, { column, op, value: takesValue(op) ? value : '' }]);
    setEditing(false);
  };

  const ops = opsFor(columns[column]?.kind ?? 'other');

  return (
    <div className="dataGrid-filters">
      {filters.map((filter, at) => (
        <span key={at} className="dataGrid-chip">
          {describeFilter(filter, columns[filter.column]?.name ?? `column ${filter.column}`)}
          <IconButton
            icon="x"
            label="Remove this filter"
            onClick={() => onChange(filters.filter((_, other) => other !== at))}
          />
        </span>
      ))}
      {editing ? (
        <form className="dataGrid-filterForm" onSubmit={submit} aria-label="Add a filter">
          <div className="z-select">
            <select
              aria-label="Column"
              value={column}
              onChange={(event) => {
                const next = Number(event.target.value);
                setColumn(next);
                setOp(opsFor(columns[next]?.kind ?? 'other')[0]);
              }}
            >
              {columns.map((each, at) => (
                <option key={at} value={at}>
                  {each.name}
                </option>
              ))}
            </select>
          </div>
          <div className="z-select">
            <select
              aria-label="Comparison"
              value={op}
              onChange={(event) => setOp(event.target.value as FilterOp)}
            >
              {ops.map((each) => (
                <option key={each} value={each}>
                  {OP_LABELS[each]}
                </option>
              ))}
            </select>
          </div>
          {takesValue(op) && (
            <input
              className="z-field"
              aria-label="Value"
              value={value}
              autoFocus
              onChange={(event) => setValue(event.target.value)}
            />
          )}
          <button type="submit" className="z-button">
            Apply
          </button>
          <button
            type="button"
            className="z-button z-button-secondary"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        addButton && (
          <button
            type="button"
            className="z-button z-button-secondary"
            onClick={() => begin(0)}
            disabled={columns.length === 0}
          >
            Add filter
          </button>
        )
      )}
      {filters.length > 0 && !editing && (
        <button type="button" className="z-button z-button-secondary" onClick={() => onChange([])}>
          Clear filters
        </button>
      )}
    </div>
  );
}
