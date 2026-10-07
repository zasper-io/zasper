/*
Package resources reads what a kernel is holding: the memory of its process tree, how full the machine
is, and what it holds on each GPU.

Nothing here knows what a kernel is. The kernel package hands over a pid per kernel and gets a Snapshot
back, so this package is testable with a made-up process table and needs no running kernel.
*/
package resources

import (
	"context"
	"sync"
	"time"
)

// Process is one row of the process table.
type Process struct {
	Pid  int
	Ppid int
	Pgid int
	// Resident memory, in bytes. What a kernel is said to hold is its footprint, which the platform
	// reads per process and falls back to this.
	RSS uint64
}

// Machine is the memory a kernel can run out of: the machine's, or its container's when the cgroup sets
// a limit.
type Machine struct {
	Used  uint64 `json:"used"`
	Total uint64 `json:"total"`
	// "machine" or "container".
	Limit string `json:"limit"`
}

// GPU is one device, as nvidia-smi reports it.
type GPU struct {
	Index int    `json:"index"`
	UUID  string `json:"-"`
	Name  string `json:"name"`
	// Percent busy over the driver's last sample period, for the whole device. Nil when the driver does
	// not say, which some virtualised GPUs do.
	Utilization *int   `json:"utilization"`
	MemoryUsed  uint64 `json:"memory_used"`
	MemoryTotal uint64 `json:"memory_total"`
	// Held by processes this server cannot see. In a container nvidia-smi names the host's pids, so all
	// of a GPU's memory can be held and none of it put down to a kernel.
	Unattributed uint64 `json:"unattributed"`
}

// GPUProcess is memory one process holds on one device.
type GPUProcess struct {
	Pid    int
	UUID   string
	Memory uint64
}

// Usage is what one kernel holds.
type Usage struct {
	// The memory of the kernel and every process it started, in bytes: each process's footprint.
	Memory uint64 `json:"memory"`
	// How many processes that is, the kernel included.
	Processes int        `json:"processes"`
	GPUs      []GPUUsage `json:"gpus"`
}

// GPUUsage is memory a kernel's processes hold on one device.
type GPUUsage struct {
	Index  int    `json:"index"`
	Memory uint64 `json:"memory"`
}

// Snapshot is one reading for every kernel asked about.
type Snapshot struct {
	// Nil where the platform's memory cannot be read.
	Memory *Machine `json:"memory"`
	GPUs   []GPU    `json:"gpus"`
	// By kernel id. A kernel whose process could not be found is left out.
	Kernels map[string]Usage `json:"kernels"`
}

// readings is everything read from the system at one moment, before it is split up by kernel.
type readings struct {
	processes []Process
	machine   *Machine
	gpus      []GPU
	gpuProcs  []GPUProcess
}

// maxAge is how long one reading answers every caller. The status bar and the Jupyter panel poll on
// their own timers, every open window does too, and nvidia-smi takes tens of milliseconds a call.
const maxAge = time.Second

// Sampler reads the system at most once a second, however many callers ask.
type Sampler struct {
	readProcesses func() ([]Process, error)
	readMachine   func() (*Machine, error)
	readGPUs      func(ctx context.Context) ([]GPU, []GPUProcess, error)
	// The memory one process is said to hold, which is read per process and only for kernels' trees.
	footprint func(Process) uint64
	now       func() time.Time

	mu   sync.Mutex
	at   time.Time
	last readings
}

// NewSampler reads this machine.
func NewSampler() *Sampler {
	smi := &nvidiaSMI{}
	return &Sampler{
		readProcesses: readProcesses,
		readMachine:   readMachine,
		readGPUs:      smi.read,
		footprint:     footprint,
		now:           time.Now,
	}
}

// Sample answers what each kernel holds, given each kernel's pid by its id.
func (s *Sampler) Sample(ctx context.Context, roots map[string]int) Snapshot {
	r := s.read(ctx)
	snapshot := Snapshot{
		Memory:  r.machine,
		GPUs:    attribute(r.gpus, r.gpuProcs, r.processes),
		Kernels: make(map[string]Usage, len(roots)),
	}
	if snapshot.GPUs == nil {
		snapshot.GPUs = []GPU{}
	}
	if r.processes == nil {
		return snapshot
	}
	for id, pid := range roots {
		if usage, ok := usageOf(pid, r, s.footprint); ok {
			snapshot.Kernels[id] = usage
		}
	}
	return snapshot
}

func (s *Sampler) read(ctx context.Context) readings {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.at.IsZero() && s.now().Sub(s.at) < maxAge {
		return s.last
	}
	var r readings
	// Each part is optional: a Mac has no GPU to read, and Windows has none of it. What failed is left
	// empty and the rest is answered.
	if processes, err := s.readProcesses(); err == nil {
		r.processes = processes
	}
	if machine, err := s.readMachine(); err == nil {
		r.machine = machine
	}
	// Not the caller's cancellation: this reading answers everyone for the next second, and a request
	// dropped by a page navigating away would otherwise kill nvidia-smi and count as its failure.
	if gpus, procs, err := s.readGPUs(context.WithoutCancel(ctx)); err == nil {
		r.gpus, r.gpuProcs = gpus, procs
	}
	s.last, s.at = r, s.now()
	return r
}

/*
tree answers the processes that belong to the one at root: its descendants, and every process in the
process group it leads.

Both, because each misses something. A worker that calls setsid leaves the kernel's group but is still
its descendant; one whose parent has exited is re-parented to init but keeps the group. The kernel is
started as a group leader (launcher.setProcessGroup), so the group is its own.
*/
func tree(root int, processes []Process) []Process {
	children := make(map[int][]int, len(processes))
	byPid := make(map[int]Process, len(processes))
	for _, p := range processes {
		children[p.Ppid] = append(children[p.Ppid], p.Pid)
		byPid[p.Pid] = p
	}
	if _, ok := byPid[root]; !ok {
		return nil
	}

	seen := map[int]bool{}
	queue := []int{root}
	for _, p := range processes {
		if p.Pgid == root {
			queue = append(queue, p.Pid)
		}
	}
	var members []Process
	for len(queue) > 0 {
		pid := queue[0]
		queue = queue[1:]
		if seen[pid] {
			continue
		}
		seen[pid] = true
		if p, ok := byPid[pid]; ok {
			members = append(members, p)
		}
		queue = append(queue, children[pid]...)
	}
	return members
}

func usageOf(root int, r readings, footprint func(Process) uint64) (Usage, bool) {
	members := tree(root, r.processes)
	if len(members) == 0 {
		return Usage{}, false
	}
	usage := Usage{Processes: len(members), GPUs: []GPUUsage{}}
	pids := make(map[int]bool, len(members))
	for _, p := range members {
		usage.Memory += footprint(p)
		pids[p.Pid] = true
	}

	held := map[string]uint64{}
	for _, gp := range r.gpuProcs {
		if pids[gp.Pid] {
			held[gp.UUID] += gp.Memory
		}
	}
	for _, gpu := range r.gpus {
		if memory := held[gpu.UUID]; memory > 0 {
			usage.GPUs = append(usage.GPUs, GPUUsage{Index: gpu.Index, Memory: memory})
		}
	}
	return usage, true
}

// attribute fills in each GPU's memory held by processes that are not in this server's process table.
func attribute(gpus []GPU, gpuProcs []GPUProcess, processes []Process) []GPU {
	visible := make(map[int]bool, len(processes))
	for _, p := range processes {
		visible[p.Pid] = true
	}
	unseen := map[string]uint64{}
	for _, gp := range gpuProcs {
		if !visible[gp.Pid] {
			unseen[gp.UUID] += gp.Memory
		}
	}
	out := make([]GPU, len(gpus))
	for i, gpu := range gpus {
		gpu.Unattributed = unseen[gpu.UUID]
		out[i] = gpu
	}
	return out
}
