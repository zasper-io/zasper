import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

import {
  ApiError,
  apiErrorMessage,
  ColumnProfile,
  exportRows,
  profileVariable,
  queryRows,
  RowFilter,
  RowQuery,
  RowSort,
  RowsPage,
} from '@/api';
import { saveAs } from '@/browser';
import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import ColumnHeader from './ColumnHeader';
import FilterBar from './FilterBar';
import { displayValue } from './filters';
import './DataGrid.scss';

const TAB_PAGE = 100;
const PAGE_SIZES = [10, 25, 100];
const EXPORT_ROWS = 100_000;

/** What a reader has done to the rows: carried from a cell to the tab it opens. */
export interface GridView {
  sort: RowSort | null;
  filters: RowFilter[];
}

interface DataGridProps {
  kernelId: string;
  /** A variable's name, or `@` and the id a cell's output carries. */
  name: string;
  /** In a cell it pages, so a run never makes the notebook longer; in a tab it scrolls. */
  mode: 'cell' | 'tab';
  /** What the bar calls it, and the name a downloaded file is given. */
  label: string;
  kindLabel?: string;
  /** Read again from the top whenever this changes. */
  reload?: number;
  initialView?: GridView;
  onOpenInTab?: (view: GridView) => void;
  /** The kernel no longer holds the table. */
  onGone?: () => void;
  /** Asks the kernel nothing while set: a tab that is not in front. */
  paused?: boolean;
}

function rowsLabel(table: RowsPage, filtered: boolean): string {
  const columns = `${table.total_columns.toLocaleString()} ${table.total_columns === 1 ? 'column' : 'columns'}`;
  return filtered
    ? `${table.matched_rows.toLocaleString()} of ${table.total_rows.toLocaleString()} rows × ${columns}`
    : `${table.total_rows.toLocaleString()} rows × ${columns}`;
}

/**
 * A DataFrame, Series or array from a kernel, as a table: sorted and filtered in the kernel, each
 * column's shape in its header, read a page at a time.
 */
export default function DataGrid(props: DataGridProps) {
  const { kernelId, name, mode, label, kindLabel = 'DataFrame', reload = 0, onGone } = props;
  const paused = props.paused ?? false;
  const [sort, setSort] = useState<RowSort | null>(props.initialView?.sort ?? null);
  const [filters, setFilters] = useState<RowFilter[]>(props.initialView?.filters ?? []);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  const [table, setTable] = useState<RowsPage | null>(null);
  const [profile, setProfile] = useState<ColumnProfile[]>([]);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [filterRequest, setFilterRequest] = useState<{ column: number; at: number } | null>(null);
  // A cell's grid asks the kernel nothing until it is near the screen: a notebook of twenty tables would
  // otherwise queue forty questions behind every run.
  const [visible, setVisible] = useState(mode === 'tab');
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  // Which query the rows on screen answer, so a page that arrives after the query changed is dropped.
  const generation = useRef(0);

  const fail = useCallback(
    (failure: unknown) => {
      if (failure instanceof ApiError && failure.status === 410) {
        onGone?.();
        return;
      }
      setError(apiErrorMessage(failure));
    },
    [onGone]
  );

  useEffect(() => {
    if (visible || root.current === null) {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && setVisible(true),
      { rootMargin: '400px' }
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [visible]);

  const query = useCallback(
    (offset: number, limit: number): RowQuery => ({
      offset,
      limit,
      ...(sort ? { sort } : {}),
      filters,
    }),
    [sort, filters]
  );

  useEffect(() => {
    if (!visible || paused) {
      return;
    }
    const mine = ++generation.current;
    const limit = mode === 'cell' ? size : TAB_PAGE;
    setReading(true);
    queryRows(kernelId, name, query(mode === 'cell' ? page * size : 0, limit))
      .then((answer) => {
        if (mine === generation.current) {
          setTable(answer);
          setError('');
          if (mode === 'tab') {
            scroller.current?.scrollTo?.({ top: 0 });
          }
        }
      })
      .catch((failure: unknown) => mine === generation.current && fail(failure))
      .finally(() => mine === generation.current && setReading(false));
  }, [visible, paused, kernelId, name, mode, reload, page, size, query, fail]);

  useEffect(() => {
    if (!visible || paused) {
      return;
    }
    let live = true;
    profileVariable(kernelId, name)
      .then((answer) => live && setProfile(answer.columns))
      .catch(() => live && setProfile([]));
    return () => {
      live = false;
    };
  }, [visible, paused, kernelId, name, reload]);

  const more = mode === 'tab' && table !== null && table.rows.length < table.matched_rows;

  const loadMore = useCallback(() => {
    if (table === null || reading || !more) {
      return;
    }
    const mine = generation.current;
    setReading(true);
    queryRows(kernelId, name, query(table.rows.length, TAB_PAGE))
      .then((answer) => {
        if (mine === generation.current) {
          setTable((current) =>
            current === null
              ? answer
              : {
                  ...answer,
                  rows: [...current.rows, ...answer.rows],
                  index: [...current.index, ...answer.index],
                }
          );
        }
      })
      .catch((failure: unknown) => mine === generation.current && fail(failure))
      .finally(() => mine === generation.current && setReading(false));
  }, [table, reading, more, kernelId, name, query, fail]);

  // The next page when the end of the table scrolls into view; the button is the same for a keyboard.
  useEffect(() => {
    const sentinel = end.current;
    if (sentinel === null || typeof IntersectionObserver === 'undefined' || !more) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && loadMore(),
      { root: scroller.current, rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [more, loadMore]);

  // The filter bar is only drawn while it has something to show, so asking for the form has to put it up.
  const askFilter = (column: number) => {
    setFormOpen(true);
    setFilterRequest({ column, at: Date.now() });
  };

  const changeSort = (next: RowSort | null) => {
    setSort(next);
    setPage(0);
  };
  const changeFilters = (next: RowFilter[]) => {
    setFilters(next);
    setPage(0);
  };

  const exportCsv = (then: (csv: string, rows: number) => void) => {
    exportRows(kernelId, name, query(0, EXPORT_ROWS))
      .then((csv) => then(csv, Math.min(table?.matched_rows ?? 0, EXPORT_ROWS)))
      .catch((failure: unknown) => toast.error(apiErrorMessage(failure)));
  };
  const truncated = (table?.matched_rows ?? 0) > EXPORT_ROWS ? ', the first 100,000' : '';
  const copyCsv = () =>
    exportCsv((csv, rows) =>
      navigator.clipboard
        .writeText(csv)
        .then(() => toast.success(`Copied ${rows.toLocaleString()} rows as CSV${truncated}.`))
        .catch(() => toast.error('The clipboard would not take the rows.'))
    );
  const downloadCsv = () =>
    exportCsv((csv) => saveAs(new Blob([csv], { type: 'text/csv' }), `${label}.csv`));

  const filtered = filters.length > 0;
  const showFilters = table?.queryable && (mode === 'tab' || filtered || formOpen);
  const pages = table === null ? 1 : Math.max(1, Math.ceil(table.matched_rows / size));
  const first = page * size + 1;
  const last = table === null ? 0 : page * size + table.rows.length;

  return (
    <div
      ref={root}
      className={[
        'dataGrid',
        mode === 'cell' ? 'is-in-cell' : 'is-tab',
        filtered ? 'has-filters' : '',
      ].join(' ')}
    >
      <div className="dataGrid-bar">
        <span className="dataGrid-title">
          <Icon name="table" size={12} />
          <strong>{kindLabel}</strong>
          {table !== null && <span className="z-tabular">{rowsLabel(table, filtered)}</span>}
        </span>
        <span className="dataGrid-actions">
          {table?.queryable && (
            <IconButton icon="list-filter" label="Filter rows" onClick={() => askFilter(0)} />
          )}
          <IconButton icon="copy" label="Copy as CSV" onClick={copyCsv} disabled={table === null} />
          <IconButton
            icon="download"
            label="Download as CSV"
            onClick={downloadCsv}
            disabled={table === null}
          />
          {props.onOpenInTab && (
            <IconButton
              icon="square-arrow-out-up-right"
              label="Open in a tab"
              onClick={() => props.onOpenInTab?.({ sort, filters })}
            />
          )}
        </span>
      </div>

      {error !== '' && (
        <div className="z-notice z-notice-error dataGrid-error" role="alert">
          <Icon name="circle-alert" size={14} />
          <p>{error}</p>
        </div>
      )}

      {table !== null && (
        <>
          {showFilters && (
            <FilterBar
              columns={table.columns}
              filters={filters}
              onChange={changeFilters}
              request={filterRequest}
              onFormChange={setFormOpen}
              addButton={mode === 'tab' || filtered}
            />
          )}
          <div className="dataGrid-scroll" ref={scroller}>
            <table className="dataframe">
              <thead>
                <tr>
                  <th />
                  {table.columns.map((column, index) => (
                    <ColumnHeader
                      key={index}
                      index={index}
                      name={column.name}
                      dtype={column.dtype}
                      kind={column.kind}
                      profile={profile[index]}
                      sort={sort}
                      queryable={table.queryable}
                      onSort={changeSort}
                      onFilter={askFilter}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <th>{table.index[rowIndex]}</th>
                    {row.map((value, columnIndex) =>
                      typeof value === 'object' ? (
                        <td key={columnIndex} className="is-missing">
                          {value.missing}
                        </td>
                      ) : (
                        <td key={columnIndex}>{displayValue(value)}</td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {table.matched_rows === 0 && (
              <p className="z-note dataGrid-empty">No rows match these filters.</p>
            )}
            {mode === 'tab' && (
              <div className="dataGrid-foot" ref={end}>
                <span className="z-tabular">
                  {`${table.rows.length.toLocaleString()} of ${table.matched_rows.toLocaleString()} rows`}
                  {table.total_columns > table.columns.length &&
                    `, and the first ${table.columns.length} of ${table.total_columns.toLocaleString()} columns`}
                </span>
                {more && (
                  <button
                    type="button"
                    className="z-button z-button-secondary"
                    disabled={reading}
                    onClick={loadMore}
                  >
                    Load {TAB_PAGE} more
                  </button>
                )}
              </div>
            )}
          </div>

          {mode === 'cell' && table.matched_rows > 0 && (
            <div className="dataGrid-foot">
              <span className="z-tabular">
                {`Rows ${first.toLocaleString()}–${last.toLocaleString()} of ${table.matched_rows.toLocaleString()}`}
              </span>
              <span className="dataGrid-pages">
                <IconButton
                  icon="chevron-left"
                  label="Previous page"
                  disabled={page === 0 || reading}
                  onClick={() => setPage(page - 1)}
                />
                <span className="z-tabular">
                  {page + 1} / {pages.toLocaleString()}
                </span>
                <IconButton
                  icon="chevron-right"
                  label="Next page"
                  disabled={page + 1 >= pages || reading}
                  onClick={() => setPage(page + 1)}
                />
              </span>
              <div className="z-select dataGrid-size">
                <select
                  aria-label="Rows per page"
                  value={size}
                  onChange={(event) => {
                    setSize(Number(event.target.value));
                    setPage(0);
                  }}
                >
                  {PAGE_SIZES.map((each) => (
                    <option key={each} value={each}>
                      {each} rows
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
