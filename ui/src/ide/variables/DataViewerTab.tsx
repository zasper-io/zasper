import { useState } from 'react';
import { useAtomValue } from 'jotai';

import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { finishedRunsAtom, notebookKernelMapAtom } from '@/store/kernels';
import { FileTab } from '@/store/tabState';
import DataGrid, { GridView } from './DataGrid';
import { parseDataViewerKey } from './dataViewerKey';

// The filters and sort a cell's grid had when it was opened in a tab, taken once by the tab it opened.
const openedWith = new Map<string, GridView>();

export function openWithView(key: string, view: GridView): void {
  openedWith.set(key, view);
}

/**
 * A variable, or a cell's DataFrame output, as a table in a tab of its own. It is read again after each
 * run of the notebook, since a run may have changed it.
 */
export default function DataViewerTab({ data }: { data: FileTab }) {
  const target = parseDataViewerKey(data.path);
  const kernelId = useAtomValue(notebookKernelMapAtom)[target?.notebookPath ?? '']?.id;
  const runs = useAtomValue(finishedRunsAtom)[kernelId ?? ''] ?? 0;
  const [reloads, setReloads] = useState(0);
  const [initialView] = useState(() => {
    const view = openedWith.get(data.path);
    openedWith.delete(data.path);
    return view;
  });
  const [gone, setGone] = useState(false);

  const problem =
    target === null
      ? 'This tab does not name a variable.'
      : kernelId === undefined
        ? `The kernel of ${target.notebookPath} is not running.`
        : gone
          ? 'This table is no longer in the kernel. Run its cell again, and open it from there.'
          : '';

  return (
    <div className="tab-surface">
      <div className={data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        <div className="editor-strip">
          <span>{data.name}</span>
          {target !== null && <span className="z-note">from {target.notebookPath}</span>}
          <span className="editor-strip-actions">
            <IconButton
              icon="refresh-cw"
              label="Refresh"
              onClick={() => setReloads((reload) => reload + 1)}
            />
          </span>
        </div>
        {problem !== '' ? (
          <div className="z-notice z-notice-error" role="alert">
            <Icon name="circle-alert" size={14} />
            <p>{problem}</p>
          </div>
        ) : (
          target !== null &&
          kernelId !== undefined && (
            <DataGrid
              kernelId={kernelId}
              name={target.name}
              mode="tab"
              label={data.name}
              reload={runs + reloads}
              initialView={initialView}
              onGone={() => setGone(true)}
              paused={!data.active}
            />
          )
        )}
      </div>
    </div>
  );
}
