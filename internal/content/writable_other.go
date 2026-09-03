//go:build !unix

package content

import "os"

// Without access(2) — Windows above all — the mode bits are what there is, and Go maps Windows'
// read-only attribute onto the owner write bit, which is the case that matters there.
func isWritable(_ string, info os.FileInfo) bool {
	return info.Mode().Perm()&0o200 != 0
}
