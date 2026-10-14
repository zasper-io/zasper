//go:build windows

package launcher

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"unsafe"

	"github.com/rs/zerolog/log"
	"golang.org/x/sys/windows"
)

/*
platform is what Windows has in place of signals and process groups.

An interrupt is an event the kernel inherits and waits on: ipykernel reads its handle from
JPY_INTERRUPT_EVENT, as jupyter_client creates it, and stops the running cell when it is set. Everything
the kernel starts goes into a job object, which ends with it: killing a wrapper kernel such as `conda run`
or npx used to leave its real kernel running, and a server that crashes takes its kernels with it, since
the job closes with the server's handle on it.
*/
type platform struct {
	mu        sync.Mutex
	interrupt windows.Handle
	job       windows.Handle
}

func prepare(cmd *exec.Cmd) (*platform, error) {
	attributes := windows.SecurityAttributes{InheritHandle: 1}
	attributes.Length = uint32(unsafe.Sizeof(attributes))
	// Auto-reset, as jupyter_client's: each interrupt is taken once.
	event, err := windows.CreateEvent(&attributes, 0, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("could not create the kernel's interrupt event: %w", err)
	}

	env := cmd.Env
	if env == nil {
		env = os.Environ()
	}
	handle := strconv.FormatUint(uint64(event), 10)
	// IPY_ is the name ipykernel read before 5.
	cmd.Env = append(env, "JPY_INTERRUPT_EVENT="+handle, "IPY_INTERRUPT_EVENT="+handle)
	cmd.SysProcAttr = &syscall.SysProcAttr{AdditionalInheritedHandles: []syscall.Handle{syscall.Handle(event)}}
	return &platform{interrupt: event}, nil
}

// started puts the process into a job of its own. A process that cannot be put there still runs; Kill then
// ends it alone, as it always did.
func (p *platform) started(process *os.Process) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		log.Warn().Err(err).Msg("could not create a job for the kernel")
		return
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
	}
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		log.Warn().Err(err).Msg("could not set up the kernel's job")
		windows.CloseHandle(job)
		return
	}
	handle, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(process.Pid))
	if err != nil {
		log.Warn().Err(err).Msg("could not open the kernel's process")
		windows.CloseHandle(job)
		return
	}
	defer windows.CloseHandle(handle)
	if err := windows.AssignProcessToJobObject(job, handle); err != nil {
		log.Warn().Err(err).Msg("could not put the kernel into its job")
		windows.CloseHandle(job)
		return
	}

	p.mu.Lock()
	p.job = job
	p.mu.Unlock()
}

// release closes both handles once the process has exited. Closing the job ends whatever the kernel left
// running.
func (p *platform) release() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, handle := range []*windows.Handle{&p.interrupt, &p.job} {
		if *handle != 0 {
			windows.CloseHandle(*handle)
			*handle = 0
		}
	}
}

// Interrupt sets the kernel's interrupt event, which is how a Windows kernel is told to stop its cell.
func (p *Process) Interrupt() error {
	if err := p.validPid(); err != nil {
		return err
	}
	if p.platform == nil {
		return errors.New("the kernel was not launched with an interrupt event")
	}
	p.platform.mu.Lock()
	defer p.platform.mu.Unlock()
	if p.platform.interrupt == 0 {
		return os.ErrProcessDone
	}
	return windows.SetEvent(p.platform.interrupt)
}

// Terminate has no gentler form than Kill here.
func (p *Process) Terminate() error {
	return p.Kill()
}

// Kill ends the kernel and everything in its job. The job holds the kernel too, so once it has ended there
// is nothing left to kill: TerminateProcess on what it already ended answers "Access is denied".
func (p *Process) Kill() error {
	if err := p.validPid(); err != nil {
		return err
	}
	if p.platform != nil {
		p.platform.mu.Lock()
		ended := false
		if p.platform.job != 0 {
			err := windows.TerminateJobObject(p.platform.job, 1)
			if err != nil {
				log.Debug().Err(err).Int("pid", p.Pid).Msg("could not end the kernel's job")
			}
			ended = err == nil
		}
		p.platform.mu.Unlock()
		if ended {
			return nil
		}
	}
	if err := p.process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	return nil
}

// Tree is not looked for here: the job holds everything the kernel started, and Kill ends it.
func (p *Process) Tree() []int { return nil }

// SignalTree does nothing here.
func SignalTree([]int, bool) {}

// Signal is "": a process here is never reported as ended by a signal.
func (p *Process) Signal() string { return "" }
