/*
The order the file browser shows a folder in.

`ByContentTypeAndName` is sorted on every directory listing (internal/content/content_manager.go),
and a listing carries three content types rather than two: `directory`, `notebook` and `file`, which
contentTypeFor decides between. The comparator only reached its name comparison when both entries
had the *same* type, so a notebook and a plain file were never compared at all and fell through in
whatever order the filesystem returned them.
*/
package models

import (
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
)

func entry(contentType, name string) ContentModel {
	return ContentModel{ContentType: contentType, Name: name}
}

func names(entries []ContentModel) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.Name
	}
	return out
}

func TestFoldersComeFirstAndEverythingElseIsSortedByName(t *testing.T) {
	// Deliberately given in an order that is neither the answer nor its reverse, so that a
	// comparator which happens to leave the input alone cannot pass.
	entries := []ContentModel{
		entry("file", "setup.py"),
		entry("notebook", "analysis.ipynb"),
		entry("directory", "src"),
		entry("file", "README.md"),
		entry("notebook", "zebra.ipynb"),
		entry("directory", "data"),
	}

	sort.Sort(ByContentTypeAndName(entries))

	assert.Equal(t, []string{
		"data", "src",
		"README.md", "analysis.ipynb", "setup.py", "zebra.ipynb",
	}, names(entries))
}

// The case the comparator used to give up on: two entries that are both files as far as the reader
// is concerned, but carry different content types.
func TestANotebookAndAFileAreOrderedAgainstEachOther(t *testing.T) {
	entries := []ContentModel{
		entry("file", "b.py"),
		entry("notebook", "a.ipynb"),
	}

	sort.Sort(ByContentTypeAndName(entries))

	assert.Equal(t, []string{"a.ipynb", "b.py"}, names(entries))
}

// sort.Sort is not stable, so a comparator that calls two entries equal leaves their order
// unspecified rather than unchanged. Sorting an already-sorted listing has to be a no-op.
func TestSortingTwiceChangesNothing(t *testing.T) {
	entries := []ContentModel{
		entry("directory", "src"),
		entry("notebook", "a.ipynb"),
		entry("file", "b.py"),
		entry("notebook", "c.ipynb"),
	}
	want := names(entries)

	for range 3 {
		sort.Sort(ByContentTypeAndName(entries))
		assert.Equal(t, want, names(entries))
	}
}
