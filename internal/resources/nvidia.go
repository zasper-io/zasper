package resources

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	smiTimeout = 3 * time.Second
	// How long a failing nvidia-smi is left alone. A driver that does not match its kernel module fails
	// slowly, and every poll would wait for it.
	smiBackoff = time.Minute
	mib        = 1024 * 1024
)

var errNoGPU = errors.New("nvidia-smi is not installed")

// nvidiaSMI runs nvidia-smi, which is looked for once: a machine without it never runs anything.
type nvidiaSMI struct {
	once sync.Once
	path string

	mu          sync.Mutex
	failedUntil time.Time
}

func (n *nvidiaSMI) read(ctx context.Context) ([]GPU, []GPUProcess, error) {
	n.once.Do(func() {
		n.path, _ = exec.LookPath("nvidia-smi")
	})
	if n.path == "" {
		return nil, nil, errNoGPU
	}
	n.mu.Lock()
	waiting := time.Now().Before(n.failedUntil)
	n.mu.Unlock()
	if waiting {
		return nil, nil, errNoGPU
	}

	gpus, procs, err := n.query(ctx)
	if err != nil {
		n.mu.Lock()
		n.failedUntil = time.Now().Add(smiBackoff)
		n.mu.Unlock()
	}
	return gpus, procs, err
}

func (n *nvidiaSMI) query(ctx context.Context) ([]GPU, []GPUProcess, error) {
	ctx, cancel := context.WithTimeout(ctx, smiTimeout)
	defer cancel()

	devices, err := exec.CommandContext(ctx, n.path,
		"--query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total",
		"--format=csv,noheader,nounits").Output()
	if err != nil {
		return nil, nil, err
	}
	gpus, err := parseGPUs(devices)
	if err != nil {
		return nil, nil, err
	}
	apps, err := exec.CommandContext(ctx, n.path,
		"--query-compute-apps=pid,gpu_uuid,used_memory",
		"--format=csv,noheader,nounits").Output()
	if err != nil {
		// The devices are still worth showing without knowing whose memory is whose.
		return gpus, nil, nil
	}
	return gpus, parseGPUProcesses(apps), nil
}

func readCSV(out []byte) ([][]string, error) {
	reader := csv.NewReader(bytes.NewReader(out))
	reader.TrimLeadingSpace = true
	reader.FieldsPerRecord = -1
	return reader.ReadAll()
}

// parseGPUs reads `--query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total`, in MiB.
func parseGPUs(out []byte) ([]GPU, error) {
	rows, err := readCSV(out)
	if err != nil {
		return nil, err
	}
	gpus := []GPU{}
	for _, row := range rows {
		if len(row) < 6 {
			continue
		}
		index, err := strconv.Atoi(strings.TrimSpace(row[0]))
		if err != nil {
			continue
		}
		gpu := GPU{
			Index:       index,
			UUID:        strings.TrimSpace(row[1]),
			Name:        strings.TrimSpace(row[2]),
			MemoryUsed:  mebibytes(row[4]),
			MemoryTotal: mebibytes(row[5]),
		}
		// `[N/A]` on a GPU whose driver does not report it.
		if busy, err := strconv.Atoi(strings.TrimSpace(row[3])); err == nil {
			gpu.Utilization = &busy
		}
		gpus = append(gpus, gpu)
	}
	return gpus, nil
}

// parseGPUProcesses reads `--query-compute-apps=pid,gpu_uuid,used_memory`, in MiB.
func parseGPUProcesses(out []byte) []GPUProcess {
	rows, err := readCSV(out)
	if err != nil {
		return nil
	}
	var procs []GPUProcess
	for _, row := range rows {
		if len(row) < 3 {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(row[0]))
		if err != nil {
			continue
		}
		procs = append(procs, GPUProcess{Pid: pid, UUID: strings.TrimSpace(row[1]), Memory: mebibytes(row[2])})
	}
	return procs
}

func mebibytes(field string) uint64 {
	value, err := strconv.ParseUint(strings.TrimSpace(field), 10, 64)
	if err != nil {
		return 0
	}
	return value * mib
}
