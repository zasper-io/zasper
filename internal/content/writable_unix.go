//go:build unix

package content

import (
	"os"
	"syscall"
)

// The W_OK of access(2). Spelled out because the standard syscall package exports the call but not
// the constant.
const writeOK = 0x2

/*
isWritable asks the kernel rather than reading the mode bits, which on their own say nothing about
whether this process owns the file, is in its group, or is looking at a filesystem mounted read-only.
The panel marks a row read-only on the strength of this, so a guess would be worse than nothing.
*/
func isWritable(osPath string, _ os.FileInfo) bool {
	return syscall.Access(osPath, writeOK) == nil
}
