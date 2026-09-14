// Package pathsafe confines paths to a root directory.
package pathsafe

import "path/filepath"

/*
Within answers path relative to root, and whether path is inside root (root itself included).

The comparison is by segment, so `../project-secrets` is not inside `project`, and neither path is
resolved: a caller that wants a symbolic link judged by where it points resolves both first.
*/
func Within(root, path string) (string, bool) {
	relative, err := filepath.Rel(root, path)
	if err != nil || !filepath.IsLocal(relative) {
		return "", false
	}
	return relative, true
}
