import { describe, expect, it } from 'vitest';

import { GpuDevice, KernelResources } from '@/api';
import { barFigures, biggestHolder, formatMemory, formatMemoryOf } from './memory';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

const a10g = (overrides: Partial<GpuDevice> = {}): GpuDevice => ({
  index: 0,
  name: 'NVIDIA A10G',
  utilization: 87,
  memory_used: 18.2 * GIB,
  memory_total: 24 * GIB,
  unattributed: 0,
  ...overrides,
});

const resources = (overrides: Partial<KernelResources> = {}): KernelResources => ({
  memory: { used: 41.6 * GIB, total: 62.8 * GIB, limit: 'machine' },
  gpus: [],
  kernels: { k: { memory: 5.1 * GIB, processes: 5, gpus: [] } },
  ...overrides,
});

describe('formatMemory', () => {
  it('writes megabytes whole, gigabytes to one place, and a hundred gigabytes whole', () => {
    expect(formatMemory(812 * MIB)).toBe('812 MB');
    expect(formatMemory(1000)).toBe('1 MB');
    expect(formatMemory(5.12 * GIB)).toBe('5.1 GB');
    expect(formatMemory(128.4 * GIB)).toBe('128 GB');
  });

  it('says the unit once when both sides share it', () => {
    expect(formatMemoryOf(41.6 * GIB, 62.8 * GIB)).toBe('41.6 of 62.8 GB');
    expect(formatMemoryOf(300 * MIB, 24 * GIB)).toBe('300 MB of 24 GB');
  });
});

describe('barFigures', () => {
  it('shows only memory for a kernel that holds nothing on a GPU', () => {
    const figures = barFigures(resources({ gpus: [a10g({ memory_used: 0 })] }), 'k');
    expect(figures.memory).toEqual({ text: '5.1 GB', warning: false });
    expect(figures.gpu).toBeNull();
  });

  it('shows nothing for a kernel the server could not read', () => {
    expect(barFigures(resources({ kernels: {} }), 'k').memory).toBeNull();
  });

  it('says how full the machine is once it is nearly full', () => {
    const full = resources({ memory: { used: 59 * GIB, total: 62.8 * GIB, limit: 'container' } });
    expect(barFigures(full, 'k').memory).toEqual({ text: '5.1 GB · container 94%', warning: true });
  });

  it('shows the GPU memory the kernel holds and how busy the device is', () => {
    const r = resources({
      gpus: [a10g()],
      kernels: { k: { memory: 5.1 * GIB, processes: 5, gpus: [{ index: 0, memory: 17.9 * GIB }] } },
    });
    const figures = barFigures(r, 'k');
    expect(figures.gpu).toEqual({ text: '17.9 GB · 87%', warning: false });
    expect(figures.devices.map((d) => d.index)).toEqual([0]);
    expect(figures.unattributed).toBe(false);
  });

  it('says a GPU is nearly full instead of how busy it is', () => {
    const r = resources({
      gpus: [a10g({ memory_used: 23 * GIB })],
      kernels: { k: { memory: GIB, processes: 1, gpus: [{ index: 0, memory: 22 * GIB }] } },
    });
    expect(barFigures(r, 'k').gpu).toEqual({ text: '22 GB · GPU 96% full', warning: true });
  });

  it('falls back to the device when nobody here can be named for its memory', () => {
    const r = resources({ gpus: [a10g({ unattributed: 18.2 * GIB })] });
    const figures = barFigures(r, 'k');
    expect(figures.gpu).toEqual({ text: 'GPU 18.2 of 24 GB · 87%', warning: false });
    expect(figures.unattributed).toBe(true);
  });
});

describe('biggestHolder', () => {
  it('names the kernel holding the most of a device', () => {
    const r = resources({
      kernels: {
        small: { memory: GIB, processes: 1, gpus: [{ index: 0, memory: 2 * GIB }] },
        big: { memory: GIB, processes: 1, gpus: [{ index: 0, memory: 9 * GIB }] },
      },
    });
    expect(biggestHolder(r, 0)).toEqual({ kernelId: 'big', memory: 9 * GIB });
    expect(biggestHolder(r, 1)).toBeNull();
  });
});
