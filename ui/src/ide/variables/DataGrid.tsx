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
// A tab draws the rows in view and this many more each way, and keeps this many pages read.
const OVERSCAN = 20;
const KEPT_PAGES = 30;
// What a row measures until one has been drawn to measure: `.dataGrid.is-tab tbody tr` holds it there.
const ROW_HEIGHT = 28;
const PAGE_SIZES = [10, 25, 100];
const EXPORT_ROWS = 100_000;

/** What a reader has done to the rows: carried from a cell to the tab it opens. */
export interface GridView {
  sort: RowSort | null;
  filters: RowFilter[];
  /** Columns by their place in the frame, in the order shown; a hidden one is left out. */
  columns?: number[];
  hidden?: number[];
  widths?: Record<number, number>;
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
  const [order, setOrder] = useState<number[] | null>(props.initialView?.columns ?? null);
  const [hidden, setHidden] = useState<number[]>(props.initialView?.hidden ?? []);
  const [widths, setWidths] = useState<Record<number, number>>(props.initialView?.widths ?? {});
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  const [table, setTable] = useState<RowsPage | null>(null);
  const [profile, setProfile] = useState<ColumnProfile[]>([]);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [filterRequest, setFilterRequest] = useState<{ column: number; at: number } | null>(null);
  // The cell the keyboard is on, by its place in the rows on screen: what Mod-C copies.
  const [selected, setSelected] = useState<{ row: number; column: number } | null>(null);
  // A cell's grid asks the kernel nothing until it is near the screen: a notebook of twenty tables would
  // otherwise queue forty questions behind every run.
  const [visible, setVisible] = useState(mode === 'tab');
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // A tab's rows, by page, read as they scroll into view and let go of once far from it.
  const heldPages = useRef(new Map<number, { rows: RowsPage['rows']; index: string[] }>());
  const asked = useRef(new Set<number>());
  // Bumped when a page arrives: the pages are a ref, and a ref write is not a render.
  const [, setPagesRead] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const rowHeight = useRef(ROW_HEIGHT);
  // Which query the rows on screen answer, so a page that arrives after the query changed is dropped.
  const generation = useRef(0);

  // In a ref: a caller's inline callback would otherwise change on every render of the notebook, and
  // with it every effect that reads the kernel.
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  const fail = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 410) {
      goneRef.current?.();
      return;
    }
    setError(apiErrorMessage(failure));
  }, []);

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
          setSelected(null);
          setError('');
          if (mode === 'tab') {
            heldPages.current = new Map([[0, { rows: answer.rows, index: answer.index }]]);
            asked.current = new Set([0]);
            setPagesRead((count) => count + 1);
            scroller.current?.scrollTo?.({ top: 0 });
            setScrollTop(0);
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

  // Which rows of the whole filtered frame a tab has in view, counted from the first.
  const firstInView = Math.max(0, Math.floor(scrollTop / rowHeight.current) - OVERSCAN);
  const lastInView =
    table === null
      ? 0
      : Math.min(
          table.matched_rows,
          Math.ceil((scrollTop + viewport) / rowHeight.current) + OVERSCAN
        );

  useEffect(() => {
    if (mode !== 'tab' || table === null || paused) {
      return;
    }
    const mine = generation.current;
    const needed: number[] = [];
    for (let at = Math.floor(firstInView / TAB_PAGE); at * TAB_PAGE < lastInView; at++) {
      if (!asked.current.has(at)) {
        needed.push(at);
      }
    }
    for (const at of needed) {
      asked.current.add(at);
      queryRows(kernelId, name, query(at * TAB_PAGE, TAB_PAGE))
        .then((answer) => {
          if (mine !== generation.current) {
            return;
          }
          heldPages.current.set(at, { rows: answer.rows, index: answer.index });
          // The pages furthest from the view go first.
          const middle = Math.floor(firstInView / TAB_PAGE);
          while (heldPages.current.size > KEPT_PAGES) {
            const furthest = [...heldPages.current.keys()].sort(
              (a, b) => Math.abs(b - middle) - Math.abs(a - middle)
            )[0];
            heldPages.current.delete(furthest);
            asked.current.delete(furthest);
          }
          setPagesRead((count) => count + 1);
        })
        .catch((failure: unknown) => {
          asked.current.delete(at);
          if (mine === generation.current) {
            fail(failure);
          }
        });
    }
  }, [mode, table, paused, firstInView, lastInView, kernelId, name, query, fail]);

  const onScroll = () => {
    const box = scroller.current;
    if (box !== null) {
      setScrollTop(box.scrollTop);
      if (box.clientHeight > 0) {
        setViewport(box.clientHeight);
      }
    }
  };

  /** A row of the table on screen, by its place in the whole filtered frame. */
  const rowAt = (at: number): { values: RowsPage['rows'][number]; label: string } | null => {
    if (mode === 'cell') {
      return table && at < table.rows.length
        ? { values: table.rows[at], label: table.index[at] }
        : null;
    }
    const held = heldPages.current.get(Math.floor(at / TAB_PAGE));
    const offset = at % TAB_PAGE;
    return held && offset < held.rows.length
      ? { values: held.rows[offset], label: held.index[offset] }
      : null;
  };

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
    exportRows(kernelId, name, { ...query(0, EXPORT_ROWS), columns: shown })
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

  // The frame's columns by position, in the order the reader arranged them, less the hidden ones. An
  // order from before the frame changed shape is dropped rather than half applied.
  const width = table?.columns.length ?? 0;
  const arranged =
    order !== null && order.length === width && order.every((at) => at < width)
      ? order
      : Array.from({ length: width }, (_, at) => at);
  const shown = arranged.filter((at) => !hidden.includes(at));
  const move = (column: number, by: number) => {
    const next = [...arranged];
    const from = next.indexOf(column);
    const to = from + by;
    if (to < 0 || to >= next.length) {
      return;
    }
    next.splice(from, 1);
    next.splice(to, 0, column);
    setOrder(next);
  };
  const dropOnto = (dragged: number, target: number) => {
    const next = arranged.filter((at) => at !== dragged);
    next.splice(next.indexOf(target), 0, dragged);
    setOrder(next);
  };
  const view = (): GridView => ({ sort, filters, columns: arranged, hidden, widths });

  /** Copies the selected cell's value as the kernel sent it, not as the grid rounded it. */
  const copyCell = () => {
    const value = selected ? rowAt(selected.row)?.values[shown[selected.column]] : undefined;
    if (value === undefined || value === null) {
      return;
    }
    const text = typeof value === 'object' ? value.missing : String(value);
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('Copied the cell.'))
      .catch(() => toast.error('The clipboard would not take the cell.'));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (selected === null || table === null) {
      return;
    }
    // Text the reader selected with the pointer is the browser's to copy.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
      if (!window.getSelection()?.toString()) {
        event.preventDefault();
        copyCell();
      }
      return;
    }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (event.key === 'Escape') {
      setSelected(null);
    } else if (moves[event.key]) {
      event.preventDefault();
      const [down, across] = moves[event.key];
      const rows = mode === 'cell' ? table.rows.length : table.matched_rows;
      const row = Math.max(0, Math.min(rows - 1, selected.row + down));
      setSelected({
        row,
        column: Math.max(0, Math.min(shown.length - 1, selected.column + across)),
      });
      // Keep the cell in view as the keyboard walks a tab's rows past the edge of the screen.
      const box = scroller.current;
      if (mode === 'tab' && box !== null) {
        const top = row * rowHeight.current;
        if (top < box.scrollTop) {
          box.scrollTop = top;
        } else if (top + rowHeight.current * 3 > box.scrollTop + box.clientHeight) {
          box.scrollTop = top + rowHeight.current * 3 - box.clientHeight;
        }
      }
    }
  };

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
        {hidden.length > 0 && (
          <button
            type="button"
            className="z-button z-button-secondary dataGrid-unhide"
            onClick={() => setHidden([])}
          >
            Show {hidden.length} hidden
          </button>
        )}
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
              onClick={() => props.onOpenInTab?.(view())}
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
          <div
            className="dataGrid-scroll"
            ref={scroller}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            onScroll={mode === 'tab' ? onScroll : undefined}
          >
            <table className="dataframe">
              <thead>
                <tr>
                  <th />
                  {shown.map((index, place) => {
                    const column = table.columns[index];
                    return (
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
                        width={widths[index]}
                        onResize={(next) => setWidths((current) => ({ ...current, [index]: next }))}
                        onHide={() => {
                          setHidden((current) => [...current, index]);
                          setSelected(null);
                        }}
                        onMoveLeft={place > 0 ? () => move(index, -1) : undefined}
                        onMoveRight={place < shown.length - 1 ? () => move(index, 1) : undefined}
                        onDropColumn={(from) => dropOnto(from, index)}
                      />
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {mode === 'tab' && firstInView > 0 && (
                  <tr className="dataGrid-spacer" aria-hidden="true">
                    <td
                      colSpan={shown.length + 1}
                      style={{ height: firstInView * rowHeight.current }}
                    />
                  </tr>
                )}
                {(mode === 'cell'
                  ? table.rows.map((_, at) => at)
                  : Array.from(
                      { length: Math.max(0, lastInView - firstInView) },
                      (_, at) => firstInView + at
                    )
                ).map((rowIndex) => {
                  const row = rowAt(rowIndex);
                  if (row === null) {
                    return (
                      <tr key={rowIndex} className="dataGrid-pending">
                        <th>…</th>
                        <td colSpan={shown.length} />
                      </tr>
                    );
                  }
                  return (
                    <tr
                      key={rowIndex}
                      ref={
                        rowIndex === firstInView && mode === 'tab'
                          ? (element) => {
                              if (element && element.offsetHeight > 0) {
                                rowHeight.current = element.offsetHeight;
                              }
                            }
                          : undefined
                      }
                    >
                      <th>{row.label}</th>
                      {shown.map((index, columnIndex) => {
                        const value = row.values[index];
                        const sized =
                          widths[index] === undefined
                            ? undefined
                            : {
                                width: widths[index],
                                minWidth: widths[index],
                                maxWidth: widths[index],
                              };
                        const isSelected =
                          selected?.row === rowIndex && selected.column === columnIndex;
                        const classes = [
                          typeof value === 'object' ? 'is-missing' : '',
                          isSelected ? 'is-selected' : '',
                        ]
                          .filter(Boolean)
                          .join(' ');
                        return (
                          <td
                            key={columnIndex}
                            className={classes || undefined}
                            style={sized}
                            aria-selected={isSelected || undefined}
                            onClick={() => {
                              setSelected({ row: rowIndex, column: columnIndex });
                              scroller.current?.focus({ preventScroll: true });
                            }}
                          >
                            {typeof value === 'object' ? value.missing : displayValue(value)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {mode === 'tab' && lastInView < table.matched_rows && (
                  <tr className="dataGrid-spacer" aria-hidden="true">
                    <td
                      colSpan={shown.length + 1}
                      style={{ height: (table.matched_rows - lastInView) * rowHeight.current }}
                    />
                  </tr>
                )}
              </tbody>
            </table>
            {table.matched_rows === 0 && (
              <p className="z-note dataGrid-empty">No rows match these filters.</p>
            )}
            {mode === 'tab' && (
              <div className="dataGrid-foot">
                <span className="z-tabular">
                  {`${table.matched_rows.toLocaleString()} rows`}
                  {table.total_columns > table.columns.length &&
                    `, and the first ${table.columns.length} of ${table.total_columns.toLocaleString()} columns`}
                </span>
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
