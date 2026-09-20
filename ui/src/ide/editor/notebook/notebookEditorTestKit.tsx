/** Fixtures and helpers NotebookEditor's tests share. The mocks are in notebookEditorFakes.ts. */
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';

import { useRunCommand } from '@/commands/registry';
import { KernelspecsState } from '@/store/kernels';
import { FileTab } from '@/store/tabState';
import { RecordedSocket } from './notebookEditorFakes';

/** The installed kernels, as /api/kernelspecs reports them: keyed by name. */
export function installedKernelspecs(...names: string[]): KernelspecsState {
  return Object.fromEntries(
    names.map((name) => [name, { name, spec: { display_name: name }, resources: {} }])
  );
}

export const notebookContent = {
  cells: [
    {
      cell_type: 'code',
      id: 'server-cell-id',
      execution_count: 0,
      source: 'print("hi")',
      outputs: [],
      metadata: {},
      reload: false,
    },
  ],
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
};

export const session = {
  id: 'session-1',
  path: 'notebook.ipynb',
  name: 'notebook.ipynb',
  type: 'notebook',
  kernel: { id: 'kernel-1', name: 'python3' },
};

// The notebook's cells arrive with their own ids, so the first uuid asked for is the msg_id of the
// first request sent.
export const firstRequestId = 'generated-cell-1';

export const tab: FileTab = {
  type: 'notebook',
  path: 'notebook.ipynb',
  name: 'notebook.ipynb',
  active: true,
  extension: 'ipynb',
  load_required: true,
  kernelspec: 'python3',
};

/** A message from the kernel, answering the request `requestId` — its `parent_header.msg_id`. */
export function kernelMessage(msgType: string, requestId: string, content: unknown) {
  return {
    header: { msg_type: msgType },
    parent_header: { msg_id: requestId },
    content,
  };
}

/** The msg_id of the nth request this socket sent, which its replies will be addressed to. */
export function requestIdOf(socket: RecordedSocket, index: number): string {
  return JSON.parse(socket.sent[index]).header.msg_id;
}

/**
 * The run button of the first cell, which lives in that cell's gutter beside its execution count:
 * run is per-cell rather than acting on whatever holds the focus.
 */
export function runButton(container: HTMLElement): HTMLElement {
  return container.querySelector('.cell-run') as HTMLElement;
}

/**
 * Stands in for the keyboard and the command palette: a surface outside the notebook that only
 * knows a command id, dispatching through the registry the way they do.
 */
export function Dispatcher({ id }: { id: string }) {
  const run = useRunCommand();
  // What the registry answered, so a test can tell a disabled command from an absent one.
  const [ran, setRan] = React.useState<boolean | null>(null);
  return (
    <button type="button" data-ran={String(ran)} onClick={() => setRan(run(id))}>
      dispatch
    </button>
  );
}

/** Clicks the Dispatcher above, i.e. runs its command id through the registry. */
export function dispatch(): void {
  fireEvent.click(screen.getByText('dispatch'));
}

/** True if the last dispatch found an enabled command; false if it was refused. */
export function dispatched(): string | undefined {
  return (screen.getByText('dispatch') as HTMLButtonElement).dataset.ran;
}
