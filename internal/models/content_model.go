package models

type ContentModel struct {
	Name           string      `json:"name"`
	ContentType    string      `json:"type"`
	Path           string      `json:"path"`
	Last_modified  string      `json:"last_modified"`
	Created        string      `json:"created"`
	Content        interface{} `json:"content"`
	Format         string      `json:"format"`
	Mimetype       string      `json:"mimetype"`
	Size           int64       `json:"size"`
	Writable       bool        `json:"writable"`
	Hash           int         `json:"hash"`
	Hash_algorithm string      `json:"hash_algorithm"`
	// Ignored is what git would not track. Set on listing entries only, since it is a property of
	// where a file sits rather than of the file, and the file browser dims those rows.
	Ignored bool `json:"ignored"`
}

// sort interface
type ByContentTypeAndName []ContentModel

func (a ByContentTypeAndName) Len() int      { return len(a) }
func (a ByContentTypeAndName) Swap(i, j int) { a[i], a[j] = a[j], a[i] }

// Folders first, then everything else by name.
//
// The rank is what makes the second half reachable. Comparing the content types directly meant the
// name comparison only ran when both entries had the *same* type — and a listing has three of them,
// since contentTypeFor calls an .ipynb a `notebook` — so a notebook and a file were never ordered
// against each other and came out in whatever order the filesystem gave them.
func (c ByContentTypeAndName) Less(i, j int) bool {
	if ri, rj := folderFirst(c[i]), folderFirst(c[j]); ri != rj {
		return ri < rj
	}
	return c[i].Name < c[j].Name
}

func folderFirst(entry ContentModel) int {
	if entry.ContentType == "directory" {
		return 0
	}
	return 1
}

// Name() string       // base name of the file
// 	Size() int64        // length in bytes for regular files; system-dependent for others
// 	Mode() FileMode     // file mode bits
// 	ModTime() time.Time // modification time
// 	IsDir() bool        // abbreviation for Mode().IsDir()
// 	Sys() any
