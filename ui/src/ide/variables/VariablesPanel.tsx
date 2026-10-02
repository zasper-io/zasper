import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';

import { ApiError, apiErrorMessage, KernelVariable, listVariables } from '@/api';
import { Icon } from '@/ide/icons';
import { finishedRunsAtom, notebookKernelMapAtom } from '@/store/kernels';
import { dockOpenAtom } from '@/store/languageServers';
import { useTabActions } from '@/store/tabActions';
import { fileTabsAtom } from '@/store/tabState';
import { variablesReloadAtom } from '@/store/variables';
import { dataViewerKey, dimensions, parseDataViewerKey } from './dataViewerKey';
import './VariablesPanel.scss';

// Long enough that a run-all of fifty cells asks once at the end rather than fifty times.
const SETTLE_MS = 300;

type Answer =
  | { state: 'none' }
  | { state: 'reading' }
  | { state: 'answered'; variables: KernelVariable[] }
  | { state: 'failed'; message: string };

/** The notebook the panel is about: the one in front, or the one whose variable is open in front. */
function useNotebookInFront(): string | null {
  const tabs = useAtomValue(fileTabsAtom);
  const last = useRef<string | null>(null);
  const active = Object.values(tabs).find((tab) => tab.active);

  if (active?.type === 'notebook') {
    last.current = active.path;
  } else if (active?.type === 'data-viewer') {
    last.current = parseDataViewerKey(active.path)?.notebookPath ?? last.current;
  }
  if (last.current !== null && !Object.values(tabs).some((tab) => tab.path === last.current)) {
    last.current = null;
  }
  return last.current;
}

/**
 * The names in the kernel of the notebook in front, read again after every run of one of its cells.
 * A table-like one opens in a tab of its own.
 */
export default function VariablesPanel() {
  const notebookPath = useNotebookInFront();
  const kernels = useAtomValue(notebookKernelMapAtom);
  const kernelId = notebookPath === null ? undefined : kernels[notebookPath]?.id;
  const runs = useAtomValue(finishedRunsAtom)[kernelId ?? ''] ?? 0;
  const reloads = useAtomValue(variablesReloadAtom);
  const open = useAtomValue(dockOpenAtom);
  const { openTab } = useTabActions();
  const [answer, setAnswer] = useState<Answer>({ state: 'none' });

  useEffect(() => {
    if (!open || kernelId === undefined) {
      return;
    }
    let live = true;
    setAnswer((previous) => (previous.state === 'answered' ? previous : { state: 'reading' }));
    const timer = window.setTimeout(() => {
      listVariables(kernelId)
        .then((variables) => live && setAnswer({ state: 'answered', variables }))
        .catch((error: unknown) => {
          if (!live) {
            return;
          }
          const message =
            error instanceof ApiError && error.status === 504
              ? 'The kernel is busy. The list updates when the running cell finishes.'
              : apiErrorMessage(error);
          setAnswer({ state: 'failed', message });
        });
    }, SETTLE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [open, kernelId, runs, reloads]);

  const rows = useMemo(() => (answer.state === 'answered' ? answer.variables : []), [answer]);

  if (notebookPath === null) {
    return <p className="z-note dockList-empty">Open a notebook to see its variables.</p>;
  }
  if (kernelId === undefined) {
    return <p className="z-note dockList-empty">This notebook has no kernel running.</p>;
  }
  if (answer.state === 'failed') {
    return <p className="z-note dockList-empty">{answer.message}</p>;
  }
  if (answer.state !== 'answered') {
    return <p className="z-note dockList-empty">Reading the kernel’s variables…</p>;
  }
  if (rows.length === 0) {
    return <p className="z-note dockList-empty">No variables are defined yet.</p>;
  }

  return (
    <ul className="dockList variablesList" aria-label="Variables">
      {rows.map((variable) => {
        const meta = [variable.type, dimensions(variable.shape, variable.size), variable.summary]
          .filter(Boolean)
          .join(' · ');
        const content = (
          <>
            <span className="variableIcon">
              <Icon name={variable.viewable ? 'table' : 'variable'} size={12} />
            </span>
            <span className="panel-row-label">{variable.name}</span>
            <span className="panel-row-meta">{meta}</span>
          </>
        );
        return (
          <li key={variable.name} className="panel-row variableRow">
            {variable.viewable ? (
              <button
                type="button"
                className="panel-row-name"
                title={`Open ${variable.name} as a table`}
                onClick={() =>
                  openTab({
                    name: variable.name,
                    path: dataViewerKey(notebookPath, variable.name),
                    type: 'data-viewer',
                    extension: null,
                  })
                }
              >
                {content}
              </button>
            ) : (
              <span className="panel-row-name" title={variable.summary}>
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
