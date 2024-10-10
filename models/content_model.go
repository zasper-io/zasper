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
}

// sort interface
type ByContentTypeAndName []ContentModel

func (a ByContentTypeAndName) Len() int      { return len(a) }
func (a ByContentTypeAndName) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (c ByContentTypeAndName) Less(i, j int) bool {
	if c[i].ContentType != c[j].ContentType {
		return c[i].ContentType == "directory"
	}
	return c[i].Name < c[j].Name
}

// Name() string       // base name of the file
// 	Size() int64        // length in bytes for regular files; system-dependent for others
// 	Mode() FileMode     // file mode bits
// 	ModTime() time.Time // modification time
// 	IsDir() bool        // abbreviation for Mode().IsDir()
// 	Sys() any
