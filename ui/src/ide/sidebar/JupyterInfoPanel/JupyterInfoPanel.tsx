import { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { deleteKernel, deleteTerminal, interruptKernel, ITerminalModel } from '@/api';
import {
  kernelspecsAtom,
  kernelStatusAtom,
  notebookKernelMapAtom,
  terminalsAtom,
} from '@/store/AppState';
import { Icon } from '@/ide/icons';
import { useTabActions } from '@/store/TabActions';
import ConfirmShutdownDialog from './ConfirmShutdownDialog';
import KernelList, { kernelLabel } from './KernelList';
import PanelSection from './PanelSection';
import TerminalList from './TerminalList';
import { IRunningKernel, useJupyterInfo } from './useJupyterInfo';
import { PanelProps } from '../types';

/**
 * What Jupyter is doing: the kernels and the shells running on the server, and the kernels that could
 * be started.
 *
 * Both running lists come from the server (see useJupyterInfo) rather than from the atoms this window
 * writes when it starts something, which is what the panel read before — so a reload no longer empties
 * a panel whose kernels and shells are all still running, and one started in another window is in it.
 * `terminalsAtom` is still read, but only to say which of the listed shells this window can open.
 */
export default function JupyterInfoPanel({ hidden }: PanelProps) {
  const { kernels, terminals, loading, busy, error, refresh, run } = useJupyterInfo(hidden);
  const kernelspecs = useAtomValue(kernelspecsAtom);
  const kernelStatus = useAtomValue(kernelStatusAtom);
  const localTerminals = useAtomValue(terminalsAtom);
  const setNotebookKernelMap = useSetAtom(notebookKernelMapAtom);
  const { openTab, closeTab } = useTabActions();
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

  // Which of the server's shells this window has a tab for, by name: the shell itself has no way to
  // say which window opened it, and a name is all the two ends share.
  const localNames = new Set(Object.keys(localTerminals));

  const shutdownTerminal = async (terminal: ITerminalModel) => {
    const worked = await run(() => deleteTerminal(terminal.id), 'Terminal shut down.');
    // A tab left open on a dead shell types into nothing. Only this window's own can be closed; one
    // belonging to another window is left to it, and drops out of the list on the next read either way.
    if (worked && localNames.has(terminal.name)) {
      closeTab(terminal.name);
    }
  };

  return (
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <div className="z-label">Jupyter info</div>
        {/* The list is polled while the panel is open, but a shutdown from a terminal is worth being
            able to confirm without waiting for the next tick. */}
        <button className="z-icon-button" title="Refresh" onClick={refresh}>
          <Icon name="refresh-cw" />
        </button>
      </div>

      {error !== '' && (
        <div className="z-notice z-notice-error">
          <Icon name="circle-alert" size={14} />
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
              {loading ? (
                // The spinner is for the first read and not for a refresh: this panel re-reads every
                // five seconds, and a list that flashes twelve times a minute is worse than a list
                // that is briefly stale. `loading` is only true before the first answer arrives.
                <p className="z-note">
                  <span className="z-spinner" />
                  Loading…
                </p>
              ) : (
                <p className="z-note">No kernels running.</p>
              )}
            </div>
          )}
        </PanelSection>

        <PanelSection title="Terminals" count={terminals.length}>
          {terminals.length > 0 ? (
            <TerminalList
              terminals={terminals}
              local={localNames}
              disabled={busy}
              // Terminal tabs are keyed by their name, so this brings that tab forward rather than
              // starting a second shell. TerminalList only offers it for a shell this window owns.
              onOpen={(terminal) =>
                openTab({ name: terminal.name, path: terminal.name, type: 'terminal' })
              }
              onShutdown={(terminal) => void shutdownTerminal(terminal)}
            />
          ) : (
            <div className="panel-section-body">
              {loading ? (
                <p className="z-note">
                  <span className="z-spinner" />
                  Loading…
                </p>
              ) : (
                <p className="z-note">No terminals running.</p>
              )}
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
            <ul className="z-list-plain noborder-list">
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
              <p className="z-note">No kernels are installed.</p>
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
