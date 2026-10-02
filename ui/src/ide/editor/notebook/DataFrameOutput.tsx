import { useState } from 'react';

import { OutputTable } from '@/api';
import { Icon } from '@/ide/icons';
import DataGrid from '@/ide/variables/DataGrid';
import { openWithView } from '@/ide/variables/DataViewerTab';
import { dataViewerKey } from '@/ide/variables/dataViewerKey';
import { useTabActions } from '@/store/tabActions';

/** What a live cell lends its outputs so a DataFrame can be explored where it was printed. */
export interface OutputTables {
  kernelId: string | undefined;
  notebookPath: string;
  executionCount: number | null | undefined;
  /** The name the cell's last line printed, when that is all it is: what a chart's code is written against. */
  variable?: string | null;
  insertBelow?: (source: string) => void;
}

interface DataFrameOutputProps {
  table: OutputTable;
  tables: OutputTables;
  /** pandas' own rendering, shown when the kernel no longer holds the frame. */
  fallback: React.ReactNode;
}

/**
 * A DataFrame a cell printed, as a grid that pages, sorts and filters in the kernel — for as long as the
 * kernel that printed it still holds it. After that it is pandas' table again, as it reads in any other
 * notebook app.
 */
export default function DataFrameOutput({ table, tables, fallback }: DataFrameOutputProps) {
  const [gone, setGone] = useState(false);
  const { openTab } = useTabActions();
  const rows = `${table.rows.toLocaleString()} rows`;

  if (tables.kernelId === undefined || gone) {
    return (
      <div>
        {fallback}
        <p className="dataGrid-static-note">
          <Icon name="info" size={12} />
          {gone
            ? `${rows}. This table is no longer in the kernel; run the cell again to page, sort and filter it.`
            : `${rows}. Run the cell to page, sort and filter them.`}
        </p>
      </div>
    );
  }

  const ref = `@${table.id}`;
  const name =
    typeof tables.executionCount === 'number' && tables.executionCount > 0
      ? `Out[${tables.executionCount}]`
      : table.kind === 'series'
        ? 'Series'
        : 'DataFrame';

  return (
    <DataGrid
      kernelId={tables.kernelId}
      name={ref}
      mode="cell"
      label={name}
      kindLabel={table.kind === 'series' ? 'Series' : 'DataFrame'}
      onGone={() => setGone(true)}
      variable={tables.variable ?? null}
      insertCode={tables.insertBelow}
      onOpenInTab={(view) => {
        const key = dataViewerKey(tables.notebookPath, ref);
        openWithView(key, view);
        openTab({ name, path: key, type: 'data-viewer', extension: null });
      }}
    />
  );
}
