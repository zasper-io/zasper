import { GpuDevice, KernelResources, KernelUsage, MachineMemory } from '@/api';

/** From here up a meter takes the warning colour and the status bar says how full. */
export const NEARLY_FULL = 0.9;

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/**
 * Memory as the system monitors write it, in powers of 1024 under the names everyone uses: `812 MB`,
 * `5.1 GB`, `24 GB`, `128 GB`. One decimal below 100 GB, where it still says something.
 */
export function formatMemory(bytes: number): string {
  if (bytes < GIB) {
    return `${Math.max(1, Math.round(bytes / MIB))} MB`;
  }
  const gib = bytes / GIB;
  // `24 GB`, not `24.0 GB`: a card's size is a whole number, and the decimal says nothing there.
  return `${gib >= 100 ? Math.round(gib) : gib.toFixed(1).replace(/\.0$/, '')} GB`;
}

/** `41.6 of 62.8 GB`, the unit said once when both are in it. */
export function formatMemoryOf(used: number, total: number): string {
  const whole = formatMemory(total);
  const part = formatMemory(used);
  const unit = whole.slice(-2);
  return part.endsWith(unit) ? `${part.slice(0, -3)} of ${whole}` : `${part} of ${whole}`;
}

export function share(used: number, total: number): number {
  return total > 0 ? Math.min(1, used / total) : 0;
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** `This machine`, or `This container` when the limit is the cgroup's. */
export function machineLabel(memory: MachineMemory): string {
  return memory.limit === 'container' ? 'This container' : 'This machine';
}

/** `NVIDIA A10G` is `A10G` where the space is short. */
export function shortGpuName(name: string): string {
  return name.replace(/^NVIDIA\s+/, '');
}

/** What the kernel's processes are, for a fact line and a tooltip. */
export function describeProcesses(usage: KernelUsage): string {
  const started = usage.processes - 1;
  if (started <= 0) {
    return 'The kernel alone';
  }
  return `The kernel and ${started} ${started === 1 ? 'process' : 'processes'} it started`;
}

export interface BarFigure {
  text: string;
  /** Nearly full: said with an icon and words, since a colour on the bar fails contrast in some themes. */
  warning: boolean;
}

export interface BarFigures {
  memory: BarFigure | null;
  gpu: BarFigure | null;
  /** The devices the menu lists: the ones the kernel holds memory on, or those whose memory nobody can be named for. */
  devices: GpuDevice[];
  /** True when the GPU figure is the device's because no memory on it could be put down to a kernel. */
  unattributed: boolean;
}

function busy(device: GpuDevice): string {
  return device.utilization === null ? '' : ` · ${device.utilization}%`;
}

/**
 * The two figures the status bar shows for one kernel: its memory, and the GPU memory it holds.
 *
 * Nothing at all for a kernel the server could not read, which is every kernel on Windows. A kernel that
 * holds nothing on any GPU has no GPU figure, unless a GPU holds memory nobody here can be named for: in
 * a container nvidia-smi reports the host's process ids, and then the device's own figures are the only
 * ones there are.
 */
export function barFigures(resources: KernelResources, kernelId: string): BarFigures {
  const none: BarFigures = { memory: null, gpu: null, devices: [], unattributed: false };
  const usage = resources.kernels[kernelId];
  if (usage === undefined) {
    return none;
  }

  const machine = resources.memory;
  const full = machine === null ? 0 : share(machine.used, machine.total);
  const memory: BarFigure =
    full >= NEARLY_FULL && machine !== null
      ? {
          text: `${formatMemory(usage.memory)} · ${machine.limit} ${percent(full)}`,
          warning: true,
        }
      : { text: formatMemory(usage.memory), warning: false };

  const held = usage.gpus
    .map((gpu) => resources.gpus.find((device) => device.index === gpu.index))
    .filter((device): device is GpuDevice => device !== undefined);
  if (held.length > 0) {
    const total = usage.gpus.reduce((sum, gpu) => sum + gpu.memory, 0);
    const busiest = held.reduce((most, device) =>
      share(device.memory_used, device.memory_total) > share(most.memory_used, most.memory_total)
        ? device
        : most
    );
    const fullest = share(busiest.memory_used, busiest.memory_total);
    const gpu =
      fullest >= NEARLY_FULL
        ? { text: `${formatMemory(total)} · GPU ${percent(fullest)} full`, warning: true }
        : { text: `${formatMemory(total)}${busy(busiest)}`, warning: false };
    return { memory, gpu, devices: held, unattributed: false };
  }

  const unseen = resources.gpus.filter((device) => device.unattributed > 0);
  if (unseen.length > 0) {
    const device = unseen.reduce((most, next) =>
      next.memory_used > most.memory_used ? next : most
    );
    const fullest = share(device.memory_used, device.memory_total);
    return {
      memory,
      gpu: {
        text: `GPU ${formatMemoryOf(device.memory_used, device.memory_total)}${busy(device)}`,
        warning: fullest >= NEARLY_FULL,
      },
      devices: unseen,
      unattributed: true,
    };
  }
  return { memory, gpu: null, devices: [], unattributed: false };
}

/** Which kernel holds the most memory on a device, and how much: for the Jupyter panel's GPU meter. */
export function biggestHolder(
  resources: KernelResources,
  index: number
): { kernelId: string; memory: number } | null {
  let biggest: { kernelId: string; memory: number } | null = null;
  for (const [kernelId, usage] of Object.entries(resources.kernels)) {
    const memory = usage.gpus.find((gpu) => gpu.index === index)?.memory ?? 0;
    if (memory > 0 && (biggest === null || memory > biggest.memory)) {
      biggest = { kernelId, memory };
    }
  }
  return biggest;
}
