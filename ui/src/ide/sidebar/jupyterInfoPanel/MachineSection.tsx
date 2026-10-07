import { KernelResources } from '@/api';
import {
  biggestHolder,
  formatMemory,
  formatMemoryOf,
  share,
  shortGpuName,
} from '@/ide/resources/memory';
import Reading from '@/ide/resources/Reading';
import PanelSection from './PanelSection';

interface MachineSectionProps {
  resources: KernelResources;
  /** The notebook a kernel is running, for the GPU meter's "of it train.ipynb". */
  notebookOf: (kernelId: string) => string | undefined;
}

/**
 * How full the machine is, above the kernels using it: its memory or its container's, and each GPU's.
 * Nothing on a platform whose memory the server does not read and that has no GPU.
 */
export default function MachineSection({ resources, notebookOf }: MachineSectionProps) {
  const { memory, gpus } = resources;
  if (memory === null && gpus.length === 0) {
    return null;
  }
  const inKernels = Object.values(resources.kernels).reduce((sum, usage) => sum + usage.memory, 0);

  return (
    <PanelSection title={memory?.limit === 'container' ? 'This container' : 'This machine'}>
      <div className="machineReadings">
        {memory !== null && (
          <Reading
            label="Memory"
            figure={formatMemoryOf(memory.used, memory.total)}
            fraction={share(memory.used, memory.total)}
            fact={`${formatMemory(inKernels)} of it in the kernels below`}
          />
        )}
        {gpus.map((gpu) => {
          const holder = biggestHolder(resources, gpu.index);
          const notebook = holder === null ? undefined : notebookOf(holder.kernelId);
          const facts = [
            gpu.utilization === null ? '' : `${gpu.utilization}% busy`,
            holder !== null && notebook !== undefined
              ? `${formatMemory(holder.memory)} of it ${notebook}`
              : '',
          ].filter(Boolean);
          return (
            <Reading
              key={gpu.index}
              label={`GPU ${gpu.index} · ${shortGpuName(gpu.name)}`}
              figure={formatMemoryOf(gpu.memory_used, gpu.memory_total)}
              fraction={share(gpu.memory_used, gpu.memory_total)}
              fact={facts.length > 0 ? facts.join(' · ') : undefined}
            />
          );
        })}
      </div>
    </PanelSection>
  );
}
