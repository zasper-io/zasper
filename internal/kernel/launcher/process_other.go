//go:build !unix && !windows

package launcher

import (
	"errors"
	"os"
	"os/exec"
)

type platform struct{}

func prepare(*exec.Cmd) (*platform, error) { return &platform{}, nil }

func (*platform) started(*os.Process) {}

func (*platform) release() {}

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

// Tree is not looked for here: Kill ends the process alone.
func (p *Process) Tree() []int { return nil }

// SignalTree does nothing here.
func SignalTree([]int, bool) {}

// Signal is "": a process here is never reported as ended by a signal.
func (p *Process) Signal() string { return "" }
