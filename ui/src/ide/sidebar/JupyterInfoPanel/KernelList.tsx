import { IKernelspecsState } from '@/store/AppState';
import { IRunningKernel } from './useJupyterInfo';

interface KernelListProps {
  kernels: IRunningKernel[];
  /** For the display name — `Python 3` rather than `python3`, as the launcher shows it. */
  kernelspecs: IKernelspecsState;
  /**
   * Busy or idle, by kernel id, for the kernels this window is attached to. A kernel that is absent
   * here gets no dot at all: the server reports no execution state, so the alternative is to draw one
   * that means nothing.
   */
  statuses: Record<string, string>;
  disabled: boolean;
  /** Opens what the kernel is running, or brings that tab forward. */
  onOpen: (kernel: IRunningKernel) => void;
  onInterrupt: (kernel: IRunningKernel) => void;
  onShutdown: (kernel: IRunningKernel) => void;
}

/** What a kernel is called, falling back to its kernelspec name while the specs are still loading. */
export function kernelLabel(kernel: IRunningKernel, kernelspecs: IKernelspecsState): string {
  return kernelspecs[kernel.name]?.spec.display_name ?? kernel.name;
}

/** The running kernels: what each one is, what it is running, and the two things to do to it. */
export default function KernelList(props: KernelListProps) {
  const { kernels, kernelspecs, statuses, disabled } = props;

  return (
    <ul className="list-unstyled noborder-list">
      {kernels.map((kernel) => {
        const label = kernelLabel(kernel, kernelspecs);
        const status = statuses[kernel.id];
        const path = kernel.session?.path;

        return (
          <li className="panel-row" key={kernel.id}>
            <button
              type="button"
              className="panel-row-name"
              // The id, because that is what a row shares with a log line or a `ps` output.
              title={
                path === undefined ? `${label} — ${kernel.id}` : `${path}\n${label} — ${kernel.id}`
              }
              // A kernel with no session has no file to open, and starting one from here would attach
              // this kernel to whatever was guessed.
              disabled={path === undefined}
              onClick={() => props.onOpen(kernel)}
            >
              {/* The slot is there either way, so the names line up down the list. */}
              <span className="panel-row-dot">
                {status !== undefined && (
                  <span
                    className={`kernelStatus kernelStatus-sm ks-${status}`}
                    title={`Kernel is ${status}`}
                  />
                )}
              </span>
              <span className="panel-row-label">{label}</span>
              {/* Which file this kernel is for — the thing the panel could never say while it read
                  atoms instead of the server's sessions. */}
              {path !== undefined && <span className="panel-row-meta">{path}</span>}
            </button>

            <span className="panel-row-actions">
              <button
                type="button"
                className="editor-button panel-row-action"
                title={`Interrupt ${label}`}
                aria-label={`Interrupt ${label}`}
                disabled={disabled}
                onClick={() => props.onInterrupt(kernel)}
              >
                <i className="fas fa-pause" />
              </button>
              <button
                type="button"
                className="editor-button panel-row-action"
                title={`Shut down ${label}`}
                aria-label={`Shut down ${label}`}
                disabled={disabled}
                onClick={() => props.onShutdown(kernel)}
              >
                <i className="fas fa-power-off" />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
