import { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { deleteKernel, interruptKernel } from '@/api';
import {
  kernelspecsAtom,
  kernelStatusAtom,
  notebookKernelMapAtom,
  terminalsAtom,
} from '@/store/AppState';
import { useTabActions } from '@/store/TabActions';
import ConfirmShutdownDialog from './ConfirmShutdownDialog';
import KernelList, { kernelLabel } from './KernelList';
import PanelSection from './PanelSection';
import { IRunningKernel, useJupyterInfo } from './useJupyterInfo';
import { PanelProps } from '../types';

/**
 * What Jupyter is doing: the kernels running on the server, the terminals open here, and the kernels
 * that could be started.
 *
 * The running list comes from the server (see useJupyterInfo) rather than from the atoms this window
 * writes when it starts something, which is what the panel read before — so a reload no longer empties
 * a panel whose kernels are all still running, and a kernel started in another window is in it.
 */
export default function JupyterInfoPanel({ hidden }: PanelProps) {
  const { kernels, loading, busy, error, refresh, run } = useJupyterInfo(hidden);
  const kernelspecs = useAtomValue(kernelspecsAtom);
  const kernelStatus = useAtomValue(kernelStatusAtom);
  const terminals = useAtomValue(terminalsAtom);
  const setNotebookKernelMap = useSetAtom(notebookKernelMapAtom);
  const { openTab } = useTabActions();
  // The kernel a shutdown has been asked for and not yet confirmed.
  const [pending, setPending] = useState<IRunningKernel | null>(null);

  const openFor = (kernel: IRunningKernel) => {
    const session = kernel.session;
    if (session === undefined) {
      return;
    }
    // Brings the tab forward when the file is already open, which is the usual case for a kernel that
    // is running: this is a way back to the notebook, not a second copy of it.
    openTab({
      name: session.name,
      path: session.path,
      type: session.type,
      kernelspec: kernel.name,
    });
  };

  const confirmShutdown = async () => {
    const kernel = pending;
    setPending(null);
    if (kernel === null) {
      return;
    }
    const worked = await run(() => deleteKernel(kernel.id), 'Kernel shut down.');
    if (worked) {
      // A notebook still bound to this kernel would go on sending execute requests to a kernel that is
      // gone, and hear nothing back.
      setNotebookKernelMap((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([, bound]) => bound.id !== kernel.id))
      );
    }
  };

  const terminalNames = Object.keys(terminals);

  return (
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <div className="z-label">Jupyter info</div>
        {/* The list is polled while the panel is open, but a shutdown from a terminal is worth being
            able to confirm without waiting for the next tick. */}
        <button className="editor-button" title="Refresh" onClick={refresh}>
          <i className="fas fa-sync"></i>
        </button>
      </div>

      {error !== '' && (
        <div className="panel-error">
          <p>{error}</p>
        </div>
      )}

      {/* One scroll area for the panel, not one per section. */}
      <div className="content-inner">
        {/* Running things first: they are the only rows here there is anything to do about. */}
        <PanelSection title="Running kernels" count={kernels.length}>
          {kernels.length > 0 ? (
            <KernelList
              kernels={kernels}
              kernelspecs={kernelspecs}
              statuses={kernelStatus}
              disabled={busy}
              onOpen={openFor}
              onInterrupt={(kernel) => void run(() => interruptKernel(kernel.id), 'Interrupted.')}
              onShutdown={setPending}
            />
          ) : (
            <div className="panel-section-body">
              <p>{loading ? 'Loading…' : 'No kernels running.'}</p>
            </div>
          )}
        </PanelSection>

        <PanelSection title="Terminals" count={terminalNames.length}>
          {terminalNames.length > 0 ? (
            <ul className="list-unstyled noborder-list">
              {terminalNames.map((name) => (
                <li className="panel-row" key={name}>
                  <button
                    type="button"
                    className="panel-row-name"
                    title={`Open ${name}`}
                    // Terminal tabs are keyed by their name, so this is the tab and not a new one.
                    onClick={() => openTab({ name, path: name, type: 'terminal' })}
                  >
                    <span className="panel-row-label">{terminals[name].name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="panel-section-body">
              {/* Said of this window, because that is all this list knows: terminals are tracked as
                  tabs, and the server has no endpoint that would report the rest. */}
              <p>No terminals open in this window.</p>
            </div>
          )}
        </PanelSection>

        {/* Reference material — what could be started, not what is — so it starts folded. */}
        <PanelSection
          title="Available kernels"
          count={Object.keys(kernelspecs).length}
          defaultOpen={false}
        >
          {Object.keys(kernelspecs).length > 0 ? (
            <ul className="list-unstyled noborder-list">
              {Object.keys(kernelspecs).map((key) => (
                <li className="panel-row" key={key}>
                  {/* Not a button: nothing is offered here. Starting a kernel is the launcher's job
                      and the notebook's kernel picker's, and a third way in is a third to keep in
                      step. */}
                  <span className="panel-row-label" title={kernelspecs[key].name}>
                    {kernelspecs[key].spec.display_name}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="panel-section-body">
              <p>No kernels are installed.</p>
            </div>
          )}
        </PanelSection>
      </div>

      {pending !== null && (
        <ConfirmShutdownDialog
          name={kernelLabel(pending, kernelspecs)}
          path={pending.session?.path}
          shuttingDown={busy}
          onConfirm={() => void confirmShutdown()}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
