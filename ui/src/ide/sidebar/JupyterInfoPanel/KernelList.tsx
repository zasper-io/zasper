import { Icon } from '@/ide/icons';
import { IKernelspecsState } from '@/store/AppState';
import { fullDate, relativeDate, shortAgo } from '../dates';
import { IRunningKernel } from './useJupyterInfo';

interface KernelListProps {
  kernels: IRunningKernel[];
  /** For the display name — `Python 3` rather than `python3`, as the launcher shows it. */
  kernelspecs: IKernelspecsState;
  /**
   * Busy or idle, by kernel id, for the kernels this window is attached to — its own reading of the
   * same `status` messages the server hears. Where it has none, the server's `execution_state` answers
   * instead, and where neither knows there is no dot rather than one that means nothing.
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

/**
 * Everything the row has no width for: the path in full, the id a log line or a `ps` output would name,
 * and what the server knows — the state, the moment exactly, and whether anything is still listening.
 *
 * The count is the one fact here that has no other way in. A kernel with no client attached is one whose
 * notebook was closed hours ago, which is the kernel this panel exists to find.
 */
function tooltip(kernel: IRunningKernel, label: string, status: string): string {
  const lines: string[] = [];
  if (kernel.session !== undefined) {
    lines.push(kernel.session.path);
  }
  lines.push(`${label} — ${kernel.id}`);
  if (status !== '') {
    lines.push(`Kernel is ${status}`);
  }
  const when = relativeDate(kernel.last_activity);
  if (when !== '') {
    lines.push(`Last active ${when} — ${fullDate(kernel.last_activity)}`);
  }
  lines.push(
    kernel.connections === 1 ? '1 client attached' : `${kernel.connections} clients attached`
  );
  return lines.join('\n');
}

/** The running kernels: what each one is, what it is running, and the two things to do to it. */
export default function KernelList(props: KernelListProps) {
  const { kernels, kernelspecs, statuses, disabled } = props;

  return (
    <ul className="z-list-plain noborder-list">
      {kernels.map((kernel) => {
        const label = kernelLabel(kernel, kernelspecs);
        // This window's own reading first, the server's after it. Both come from the kernel's `status`
        // messages, but a window attached to the kernel hears them as they are published while the
        // server's copy is at most one poll old — and for a kernel nothing here is attached to, the
        // server's is the only one there is.
        const status = statuses[kernel.id] ?? kernel.execution_state ?? '';
        const since = shortAgo(kernel.last_activity);
        const path = kernel.session?.path;

        return (
          <li className="panel-row" key={kernel.id}>
            <button
              type="button"
              className="panel-row-name"
              title={tooltip(kernel, label, status)}
              // A kernel with no session has no file to open, and starting one from here would attach
              // this kernel to whatever was guessed.
              disabled={path === undefined}
              onClick={() => props.onOpen(kernel)}
            >
              {/* The slot is there either way, so the names line up down the list. */}
              <span className="panel-row-dot">
                {status !== '' && (
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

            {/* How long since the kernel last said anything, which is how an abandoned kernel is told
                from one that is being used. `3m`, because two buttons are already in this row. */}
            {since !== '' && (
              <span
                className="panel-row-time z-tabular"
                title={`Last active ${relativeDate(kernel.last_activity)}`}
              >
                {since}
              </span>
            )}

            <span className="panel-row-actions">
              <button
                type="button"
                className="z-icon-button panel-row-action"
                title={`Interrupt ${label}`}
                aria-label={`Interrupt ${label}`}
                disabled={disabled}
                onClick={() => props.onInterrupt(kernel)}
              >
                <Icon name="pause" />
              </button>
              <button
                type="button"
                className="z-icon-button panel-row-action"
                title={`Shut down ${label}`}
                aria-label={`Shut down ${label}`}
                disabled={disabled}
                onClick={() => props.onShutdown(kernel)}
              >
                <Icon name="power" />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
