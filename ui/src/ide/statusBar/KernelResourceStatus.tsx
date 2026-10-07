import { useAtomValue } from 'jotai';

import { useRunCommand } from '@/commands/registry';
import { Icon } from '@/ide/icons';
import {
  barFigures,
  describeProcesses,
  formatMemory,
  formatMemoryOf,
  machineLabel,
  share,
  shortGpuName,
} from '@/ide/resources/memory';
import Reading from '@/ide/resources/Reading';
import { kernelResourcesAtom, usePollKernelResources } from '@/store/kernelResources';
import { notebookKernelMapAtom } from '@/store/kernels';
import { MenuAction, MenuGroup, MenuSeparator, StatusPicker } from './StatusMenu';

/** Often enough to watch a training loop fill a GPU, and only while a notebook is in front. */
const POLL_MS = 2000;

/**
 * The memory the notebook in front is using and the GPU memory it holds, and a menu with what each is
 * measured against. Nothing for a notebook without a running kernel, or where the server cannot read it.
 */
export default function KernelResourceStatus({ path }: { path: string }) {
  const kernelId = useAtomValue(notebookKernelMapAtom)[path]?.id;
  const resources = useAtomValue(kernelResourcesAtom);
  const runCommand = useRunCommand();
  usePollKernelResources(kernelId !== undefined, POLL_MS);

  if (kernelId === undefined || resources === null) {
    return null;
  }
  const figures = barFigures(resources, kernelId);
  const usage = resources.kernels[kernelId];
  if (figures.memory === null || usage === undefined) {
    return null;
  }
  const { memory, gpu } = figures;
  const machine = resources.memory;

  return (
    <StatusPicker
      menuClassName="kernelResourceMenu"
      label={
        <>
          <Icon name={memory.warning ? 'triangle-alert' : 'memory-stick'} size={12} />
          {memory.text}
          {gpu !== null && (
            <>
              <Icon
                name={gpu.warning ? 'triangle-alert' : 'microchip'}
                size={12}
                className="kernelResourceGpu"
              />
              {gpu.text}
            </>
          )}
        </>
      }
      spokenLabel={
        gpu === null
          ? `Kernel memory ${memory.text}`
          : `Kernel memory ${memory.text}, GPU ${gpu.text}`
      }
    >
      {(close) => (
        <>
          <MenuGroup label="Memory" />
          <li role="presentation">
            <Reading
              label="This kernel"
              figure={formatMemory(usage.memory)}
              fraction={machine === null ? 0 : share(usage.memory, machine.total)}
              fact={describeProcesses(usage)}
            />
          </li>
          {machine !== null && (
            <li role="presentation">
              <Reading
                label={machineLabel(machine)}
                figure={formatMemoryOf(machine.used, machine.total)}
                fraction={share(machine.used, machine.total)}
              />
            </li>
          )}

          {figures.devices.map((device) => {
            const held = usage.gpus.find((g) => g.index === device.index)?.memory ?? 0;
            return (
              <li key={device.index} role="presentation">
                <ul className="z-list-plain" role="presentation">
                  <MenuSeparator />
                  <MenuGroup label={`GPU ${device.index} · ${shortGpuName(device.name)}`} />
                  <li role="presentation">
                    {figures.unattributed ? (
                      <Reading
                        label="In use"
                        figure={formatMemoryOf(device.memory_used, device.memory_total)}
                        fraction={share(device.memory_used, device.memory_total)}
                        fact="By processes the server cannot see, as in a container: none of it can be put down to this kernel"
                      />
                    ) : (
                      <Reading
                        label="This kernel"
                        figure={formatMemory(held)}
                        fraction={share(held, device.memory_total)}
                        fact={`${formatMemoryOf(device.memory_used, device.memory_total)} in use · ${formatMemory(Math.max(0, device.memory_used - held))} by other processes`}
                      />
                    )}
                  </li>
                  {device.utilization !== null && (
                    <li role="presentation">
                      <Reading
                        label="Busy"
                        figure={`${device.utilization}%`}
                        fraction={device.utilization / 100}
                        fact="The whole GPU, not only this kernel"
                      />
                    </li>
                  )}
                </ul>
              </li>
            );
          })}

          <MenuSeparator />
          {/* The only thing that gives all of it back. The notebook's own command, so it asks first. */}
          <MenuAction
            label="Restart kernel"
            icon="rotate-cw"
            onSelect={() => {
              close();
              runCommand('notebook:restart-kernel');
            }}
          />
        </>
      )}
    </StatusPicker>
  );
}
