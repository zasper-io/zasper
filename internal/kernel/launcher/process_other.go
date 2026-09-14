//go:build !unix

package launcher

import (
	"errors"
	"os"
	"os/exec"
)

func setProcessGroup(cmd *exec.Cmd) {}

// Interrupt is not supported without Unix signals.
func (p *Process) Interrupt() error {
	if err := p.validPid(); err != nil {
		return err
	}
	return errors.New("interrupting a kernel by signal is not supported on this platform")
}

// Terminate has no gentler form than Kill here.
func (p *Process) Terminate() error {
	return p.Kill()
}

// Kill ends the kernel process.
func (p *Process) Kill() error {
	if err := p.validPid(); err != nil {
		return err
	}
	if err := p.process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	return nil
}
