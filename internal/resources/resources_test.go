package resources

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const gib = 1024 * mib

// A kernel (100) with two DataLoader workers, one of which started a helper of its own; a worker that
// called setsid (104); one whose parent exited and kept the group (105); and a process of nobody's (200).
var table = []Process{
	{Pid: 1, Ppid: 0, Pgid: 1, RSS: 10 * mib},
	{Pid: 100, Ppid: 1, Pgid: 100, RSS: 1 * gib},
	{Pid: 101, Ppid: 100, Pgid: 100, RSS: 2 * gib},
	{Pid: 102, Ppid: 100, Pgid: 100, RSS: 2 * gib},
	{Pid: 103, Ppid: 101, Pgid: 100, RSS: 100 * mib},
	{Pid: 104, Ppid: 100, Pgid: 104, RSS: 50 * mib},
	{Pid: 105, Ppid: 1, Pgid: 100, RSS: 25 * mib},
	{Pid: 200, Ppid: 1, Pgid: 200, RSS: 8 * gib},
}

// The table's processes are made up, so their footprint is their resident size rather than a system call
// about whatever really has that pid.
func resident(p Process) uint64 { return p.RSS }

func pids(processes []Process) []int {
	out := make([]int, len(processes))
	for i, p := range processes {
		out[i] = p.Pid
	}
	return out
}

func TestAKernelsTreeIsItsDescendantsAndItsGroup(t *testing.T) {
	assert.ElementsMatch(t, []int{100, 101, 102, 103, 104, 105}, pids(tree(100, table)))
	assert.Empty(t, tree(999, table), "a kernel that has exited holds nothing")
}

func TestUsageAddsUpTheTreeAndItsGPUMemory(t *testing.T) {
	gpus := []GPU{{Index: 0, UUID: "GPU-a"}, {Index: 1, UUID: "GPU-b"}}
	procs := []GPUProcess{
		{Pid: 100, UUID: "GPU-a", Memory: 6 * gib},
		{Pid: 101, UUID: "GPU-a", Memory: 1 * gib},
		{Pid: 200, UUID: "GPU-b", Memory: 3 * gib},
	}

	usage, ok := usageOf(100, readings{processes: table, gpus: gpus, gpuProcs: procs}, resident)
	require.True(t, ok)
	assert.Equal(t, uint64(5*gib+175*mib), usage.Memory)
	assert.Equal(t, 6, usage.Processes)
	assert.Equal(t, []GPUUsage{{Index: 0, Memory: 7 * gib}}, usage.GPUs, "only the devices it holds memory on")
}

func TestGPUMemoryNobodyHereHoldsIsUnattributed(t *testing.T) {
	gpus := []GPU{{Index: 0, UUID: "GPU-a"}}
	// 4242 is a pid from the host's namespace, as nvidia-smi reports it inside a container.
	procs := []GPUProcess{{Pid: 100, UUID: "GPU-a", Memory: gib}, {Pid: 4242, UUID: "GPU-a", Memory: 5 * gib}}

	assert.Equal(t, uint64(5*gib), attribute(gpus, procs, table)[0].Unattributed)
}

func TestTheSamplerReadsOnceASecond(t *testing.T) {
	now := time.Unix(0, 0)
	reads := 0
	s := &Sampler{
		readProcesses: func() ([]Process, error) { reads++; return table, nil },
		readMachine:   func() (*Machine, error) { return &Machine{Used: 40 * gib, Total: 64 * gib, Limit: "machine"}, nil },
		readGPUs: func(context.Context) ([]GPU, []GPUProcess, error) {
			return nil, nil, errNoGPU
		},
		footprint: resident,
		now:       func() time.Time { return now },
	}

	first := s.Sample(t.Context(), map[string]int{"k1": 100, "gone": 999})
	s.Sample(t.Context(), map[string]int{"k1": 100})
	assert.Equal(t, 1, reads)
	now = now.Add(maxAge)
	s.Sample(t.Context(), map[string]int{"k1": 100})
	assert.Equal(t, 2, reads)

	assert.Contains(t, first.Kernels, "k1")
	assert.NotContains(t, first.Kernels, "gone")
	assert.Equal(t, uint64(64*gib), first.Memory.Total)
	assert.Equal(t, []GPU{}, first.GPUs, "an empty list rather than null, on a machine with no GPU")
}

func TestAPlatformThatCannotReadProcessesAnswersNoKernels(t *testing.T) {
	s := &Sampler{
		readProcesses: func() ([]Process, error) { return nil, errors.New("unsupported") },
		readMachine:   func() (*Machine, error) { return nil, errors.New("unsupported") },
		readGPUs:      func(context.Context) ([]GPU, []GPUProcess, error) { return nil, nil, errNoGPU },
		footprint:     resident,
		now:           time.Now,
	}

	snapshot := s.Sample(t.Context(), map[string]int{"k1": 100})
	assert.Nil(t, snapshot.Memory)
	assert.Empty(t, snapshot.Kernels)
}

func TestACancelledCallerDoesNotCancelTheSharedReading(t *testing.T) {
	var cancelled bool
	s := &Sampler{
		readProcesses: func() ([]Process, error) { return table, nil },
		readMachine:   func() (*Machine, error) { return nil, errors.New("unsupported") },
		readGPUs: func(ctx context.Context) ([]GPU, []GPUProcess, error) {
			cancelled = ctx.Err() != nil
			return []GPU{{Index: 0, UUID: "GPU-a"}}, nil, nil
		},
		footprint: resident,
		now:       time.Now,
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	snapshot := s.Sample(ctx, map[string]int{"k1": 100})
	assert.False(t, cancelled)
	assert.Len(t, snapshot.GPUs, 1)
}
