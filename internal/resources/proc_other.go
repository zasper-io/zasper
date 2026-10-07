//go:build !linux && !darwin

package resources

import "errors"

// Windows and the BSDs: nothing is read, and the app shows no memory.
var errUnsupported = errors.New("process memory is not read on this platform")

func readProcesses() ([]Process, error) {
	return nil, errUnsupported
}

func readMachine() (*Machine, error) {
	return nil, errUnsupported
}

func footprint(p Process) uint64 {
	return p.RSS
}
