//go:build unix

package launcher

import (
	"errors"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// Interrupt sends SIGINT to the kernel's process group.
func (p *Process) Interrupt() error {
	return p.signalGroup(syscall.SIGINT)
}

// Terminate asks the kernel's process group to exit.
func (p *Process) Terminate() error {
	return p.signalGroup(syscall.SIGTERM)
}

// Kill ends the kernel's process group.
func (p *Process) Kill() error {
	return p.signalGroup(syscall.SIGKILL)
}

// A group with nothing left in it is not an error: the kernel and everything it started are already gone.
func (p *Process) signalGroup(signal syscall.Signal) error {
	if err := p.validPid(); err != nil {
		return err
	}
	if err := syscall.Kill(-p.Pid, signal); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// Tree is every process the launched one has started, and theirs, found while their parents are still
// alive: a launcher such as npx can start its children outside the process group and exit first.
func (p *Process) Tree() []int {
	out, err := exec.Command("ps", "-A", "-o", "pid=,ppid=").Output()
	if err != nil {
		return nil
	}
	children := map[int][]int{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		pid, err1 := strconv.Atoi(fields[0])
		ppid, err2 := strconv.Atoi(fields[1])
		if err1 == nil && err2 == nil {
			children[ppid] = append(children[ppid], pid)
		}
	}
	var tree []int
	for queue := children[p.Pid]; len(queue) > 0; queue = queue[1:] {
		tree = append(tree, queue[0])
		queue = append(queue, children[queue[0]]...)
	}
	return tree
}

// SignalTree sends signal to each of pids, which Tree found; kill is SIGKILL rather than SIGTERM.
func SignalTree(pids []int, kill bool) {
	signal := syscall.SIGTERM
	if kill {
		signal = syscall.SIGKILL
	}
	for _, pid := range pids {
		syscall.Kill(pid, signal)
	}
}
