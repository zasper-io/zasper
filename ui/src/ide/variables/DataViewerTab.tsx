import { useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';

import { apiErrorMessage, previewVariable, VariablePreview } from '@/api';
import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { finishedRunsAtom, notebookKernelMapAtom } from '@/store/kernels';
import { FileTab } from '@/store/tabState';
import { dimensions, parseDataViewerKey } from './dataViewerKey';
import './DataViewerTab.scss';

const PAGE_ROWS = 100;

/**
 * A DataFrame, Series or array from a notebook's kernel, as a table read a page at a time. It is read
 * again from the top after each run of the notebook, since a run may have changed it.
 */
export default function DataViewerTab({ data }: { data: FileTab }) {
  const target = parseDataViewerKey(data.path);
  const kernelId = useAtomValue(notebookKernelMapAtom)[target?.notebookPath ?? '']?.id;
  const runs = useAtomValue(finishedRunsAtom)[kernelId ?? ''] ?? 0;
  const [table, setTable] = useState<VariablePreview | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [reloads, setReloads] = useState(0);
  const name = target?.name ?? '';

  useEffect(() => {
    if (!data.active || kernelId === undefined || name === '') {
      return;
    }
    let live = true;
    setReading(true);
    previewVariable(kernelId, name, 0, PAGE_ROWS)
      .then((page) => {
        if (live) {
          setTable(page);
          setError('');
        }
      })
      .catch((failure: unknown) => live && setError(apiErrorMessage(failure)))
      .finally(() => live && setReading(false));
    return () => {
      live = false;
    };
  }, [data.active, kernelId, name, runs, reloads]);

  const loadMore = useCallback(() => {
    if (table === null || kernelId === undefined) {
      return;
    }
    setReading(true);
    previewVariable(kernelId, name, table.rows.length, PAGE_ROWS)
      .then((page) =>
        setTable((current) =>
          current === null
            ? page
            : {
                ...page,
                rows: [...current.rows, ...page.rows],
                index: [...current.index, ...page.index],
              }
        )
      )
      .catch((failure: unknown) => setError(apiErrorMessage(failure)))
      .finally(() => setReading(false));
  }, [table, kernelId, name]);

  const missing =
    target === null
      ? 'This tab does not name a variable.'
      : kernelId === undefined
        ? `The kernel of ${target.notebookPath} is not running.`
        : '';

  return (
    <div className="tab-surface">
      <div className={data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        <div className="editor-strip">
          <span>{name}</span>
          {table !== null && (
            <span className="z-note">
              {dimensions([table.total_rows, table.total_columns], null)}
            </span>
          )}
          <span className="editor-strip-actions">
            <IconButton
              icon="refresh-cw"
              label="Refresh"
              onClick={() => setReloads((count) => count + 1)}
            />
          </span>
        </div>
        {(missing || error) && (
          <div className="z-notice z-notice-error" role="alert">
            <Icon name="circle-alert" size={14} />
            <p>{missing || error}</p>
          </div>
        )}
        {table !== null && !missing && (
          <div className="dataViewer">
            <table className="dataframe">
              <thead>
                <tr>
                  <th />
                  {table.columns.map((column) => (
                    <th key={column.name} title={column.dtype}>
                      {column.name}
                      <span className="dataViewer-dtype">{column.dtype}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={table.index[rowIndex] + ':' + rowIndex}>
                    <th>{table.index[rowIndex]}</th>
                    {row.map((value, columnIndex) =>
                      typeof value === 'object' ? (
                        <td key={columnIndex} className="is-missing">
                          {value.missing}
                        </td>
                      ) : (
                        <td key={columnIndex}>{String(value)}</td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dataViewer-foot">
              <span className="z-note">
                {`Showing ${table.rows.length.toLocaleString()} of ${table.total_rows.toLocaleString()} rows`}
                {table.total_columns > table.columns.length &&
                  ` and the first ${table.columns.length} of ${table.total_columns.toLocaleString()} columns`}
              </span>
              {table.rows.length < table.total_rows && (
                <button
                  type="button"
                  className="z-button z-button-secondary"
                  disabled={reading}
                  onClick={loadMore}
                >
                  Load {PAGE_ROWS} more
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
