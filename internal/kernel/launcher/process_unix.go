//go:build unix

package launcher

import (
	"errors"
	"os/exec"
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
