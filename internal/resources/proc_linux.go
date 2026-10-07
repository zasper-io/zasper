package resources

import (
	"os"
	"path/filepath"
	"strconv"
)

// readProcesses walks /proc. A process that exits between the listing and the read is skipped.
func readProcesses() ([]Process, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	page := uint64(os.Getpagesize())
	processes := make([]Process, 0, len(entries))
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		stat, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if err != nil {
			continue
		}
		if p, ok := parseStat(pid, stat, page); ok {
			processes = append(processes, p)
		}
	}
	return processes, nil
}

/*
readMachine answers the cgroup's limit when there is one, and the machine's memory otherwise.

A container's limit is the one it is killed at, whatever the host has. Its usage counts the page cache,
which the kernel gives back before it kills anything, so the inactive part of it is taken off, as
`docker stats` does.
*/
func readMachine() (*Machine, error) {
	host, err := readMeminfo()
	if err != nil {
		return nil, err
	}
	if limited, ok := readCgroup(host.Total); ok {
		return limited, nil
	}
	return host, nil
}

func readMeminfo() (*Machine, error) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return parseMeminfo(file)
}

func readCgroup(hostTotal uint64) (*Machine, bool) {
	// cgroup v2, then v1.
	if machine, ok := cgroupMemory("/sys/fs/cgroup", "memory.max", "memory.current", "inactive_file", hostTotal); ok {
		return machine, true
	}
	return cgroupMemory("/sys/fs/cgroup/memory", "memory.limit_in_bytes", "memory.usage_in_bytes", "total_inactive_file", hostTotal)
}

/*
footprint is a process's proportional set size: its private pages, and its share of the pages it shares.
A DataLoader's workers are forked from the kernel and share its pages until they write to them, so adding
up their resident sets counts the same memory once per worker. Read from smaps_rollup, which the kernel
builds by walking the process's page tables, so only for the processes in a kernel's tree.
*/
func footprint(p Process) uint64 {
	rollup, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(p.Pid), "smaps_rollup"))
	if err != nil {
		return p.RSS
	}
	if pss, ok := parsePss(rollup); ok {
		return pss
	}
	return p.RSS
}
