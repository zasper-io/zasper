package resources

import (
	"context"
	"encoding/binary"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const psTimeout = 2 * time.Second

// readProcesses asks ps, since macOS has no /proc. One call for every process, in KiB.
func readProcesses() ([]Process, error) {
	ctx, cancel := context.WithTimeout(context.Background(), psTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ps", "-A", "-o", "pid=,ppid=,pgid=,rss=").Output()
	if err != nil {
		return nil, err
	}
	return parsePS(string(out)), nil
}

/*
readMachine answers what Activity Monitor calls Memory Used: wired, active and compressed pages. Inactive
and purgeable pages are left out, because macOS hands them back before anything runs short.
*/
func readMachine() (*Machine, error) {
	ctx, cancel := context.WithTimeout(context.Background(), psTimeout)
	defer cancel()
	size, err := exec.CommandContext(ctx, "sysctl", "-n", "hw.memsize").Output()
	if err != nil {
		return nil, err
	}
	total, err := strconv.ParseUint(strings.TrimSpace(string(size)), 10, 64)
	if err != nil {
		return nil, err
	}
	vm, err := exec.CommandContext(ctx, "vm_stat").Output()
	if err != nil {
		return nil, err
	}
	used, err := parseVMStat(string(vm))
	if err != nil {
		return nil, err
	}
	return &Machine{Used: min(used, total), Total: total, Limit: "machine"}, nil
}

const (
	sysProcInfo           = 336 // SYS_proc_info
	procInfoCallPidRusage = 9   // PROC_INFO_CALL_PIDRUSAGE
	rusageInfoV0          = 0
	// rusage_info_v0: a 16-byte uuid, then eleven uint64s; ri_phys_footprint is the eighth.
	footprintOffset = 16 + 7*8
)

/*
footprint is what Activity Monitor shows in its Memory column: the process's dirty memory, compressed
pages included. Resident size is not it. macOS compresses memory nothing has touched for a while, so a
worker holding 400 MB it wrote once reads as 80 MB resident within seconds.

proc_pid_rusage is libproc's wrapper for the proc_info system call, made here directly because release
builds have no cgo. Another user's process answers EPERM, and keeps its resident size.
*/
func footprint(p Process) uint64 {
	var info [96]byte
	_, _, errno := syscall.Syscall6(sysProcInfo, procInfoCallPidRusage, uintptr(p.Pid), rusageInfoV0, 0,
		uintptr(unsafe.Pointer(&info[0])), 0)
	if errno != 0 {
		return p.RSS
	}
	return binary.LittleEndian.Uint64(info[footprintOffset : footprintOffset+8])
}
