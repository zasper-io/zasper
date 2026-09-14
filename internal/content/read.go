package content

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"time"
	"unicode/utf8"

	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/nbformat"

	"github.com/rs/zerolog/log"
)

/*
GetContent reads a directory listing, a notebook, or a file. A file's format is "text", "base64", or ""
for whichever of the two keeps its bytes; withHash adds a SHA-256 of the file.
*/
func (p Project) GetContent(relativePath string, contentType string, format string, withHash bool) (models.ContentModel, error) {
	log.Debug().Msgf("getting content for path : %s", relativePath)
	// get path info
	osPath := p.SafePath(relativePath)
	info, err := os.Lstat(osPath)

	if err != nil {
		return models.ContentModel{}, err
	}

	var model models.ContentModel

	log.Debug().Msgf("Is directory %t", info.IsDir())
	if info.IsDir() {
		model, err = p.getDirectoryModel(relativePath)
	} else {
		if contentType == "notebook" {
			model, err = p.getNotebookModel(relativePath)
		} else {
			model, err = p.getFileModelWithContent(relativePath, format, withHash)
		}

	}
	if err != nil {
		return models.ContentModel{}, err
	}

	return model, nil
}

func (p Project) getNotebookModel(path string) (models.ContentModel, error) {
	osPath := p.SafePath(path)

	info, err := os.Lstat(osPath)

	if err != nil {
		return models.ContentModel{}, err
	}

	content, err := os.ReadFile(osPath)
	if err != nil {
		return models.ContentModel{}, err
	}

	nb, err := nbformat.Read(content)
	if err != nil {
		return models.ContentModel{}, err
	}
	for _, problem := range nbformat.Validate(nb) {
		log.Warn().Msgf("%s does not match the notebook format: %s", path, problem)
	}

	output := models.ContentModel{
		Name:         info.Name(),
		Path:         path,
		ContentType:  "notebook",
		Format:       "json",
		Content:      nb,
		Created:      info.ModTime().UTC().Format(time.RFC3339),
		LastModified: info.ModTime().UTC().Format(time.RFC3339),
		Size:         info.Size()}
	return output, nil
}

func (p Project) getDirectoryModel(relativePath string) (models.ContentModel, error) {
	log.Debug().Msgf("relative path %s", relativePath)
	abspath := p.SafePath(relativePath)

	info, err := os.Lstat(abspath)
	if err != nil {
		return models.ContentModel{}, err
	}

	output := models.ContentModel{
		ContentType:  "directory",
		Name:         filepath.Base(abspath),
		Path:         relativePath,
		Created:      info.ModTime().UTC().Format(time.RFC3339),
		LastModified: info.ModTime().UTC().Format(time.RFC3339),
	}

	dir, err := os.Open(abspath)
	if err != nil {
		return models.ContentModel{}, err
	}
	defer dir.Close()

	files, err := dir.Readdir(0)
	if err != nil {
		return models.ContentModel{}, err
	}

	// Built once for the whole listing rather than per entry: every entry here shares the same set of
	// applicable .gitignore files.
	segments := pathSegments(relativePath)
	ignores := p.ignoreMatcherFor(segments)
	// Everything inside an ignored folder is ignored, whatever the patterns say about the names
	// themselves.
	insideIgnored := len(segments) > 0 && ignores.Match(segments, true)

	listOfContents := []models.ContentModel{}
	for _, v := range files {
		fileContent, err := getFileModel(abspath, relativePath, v.Name())
		if err != nil {
			// A file that has gone between the readdir and the stat is not worth failing the listing
			// over; it will simply not be in it.
			log.Debug().Err(err).Msgf("skipping %s in the listing of %s", v.Name(), relativePath)
			continue
		}
		fileContent.Ignored = insideIgnored || ignores.Match(entrySegments(segments, v.Name()), v.IsDir())
		listOfContents = append(listOfContents, fileContent)
	}

	sort.Sort(models.ByContentTypeAndName(listOfContents))
	output.Content = listOfContents
	output.Writable = isWritable(abspath, info)
	return output, nil
}

func entrySegments(dirSegments []string, name string) []string {
	// A fresh slice each time: appending to dirSegments would hand every entry the same backing array.
	entry := make([]string, 0, len(dirSegments)+1)
	entry = append(entry, dirSegments...)
	return append(entry, name)
}

func getFileModel(abspath, relativePath, fileName string) (models.ContentModel, error) {

	osPath := filepath.Join(abspath, fileName)

	info, err := os.Lstat(osPath)

	if err != nil {
		return models.ContentModel{}, err
	}
	contentType := contentTypeFor(fileName, info.IsDir())

	path := relativePath + "/" + fileName
	if relativePath == "." {
		path = fileName
	}

	output := models.ContentModel{
		Name:         info.Name(),
		Path:         path,
		ContentType:  contentType,
		Created:      info.ModTime().UTC().Format(time.RFC3339),
		LastModified: info.ModTime().UTC().Format(time.RFC3339),
		Size:         info.Size(),
		Writable:     isWritable(osPath, info)}
	return output, nil

}

// contentTypeFor is the one place that decides what the client is looking at, since a listing entry,
// a newly created file and a copy all have to agree.
func contentTypeFor(name string, isDir bool) string {
	if isDir {
		return "directory"
	}
	if filepath.Ext(name) == ".ipynb" {
		return "notebook"
	}
	return "file"
}

/*
The largest file sent as content. The model carries the whole file inside one JSON answer, so a
multi-gigabyte log would be read into memory and encoded in full; the download endpoint streams files of
any size.
*/

var errNotText = errors.New("it is not UTF-8 text")

/*
getFileModelWithContent reads a file as text or as base64. Text is only ever UTF-8 as it is on disk:
encoding/json replaces invalid UTF-8 with U+FFFD, so a Latin-1 or binary file sent as text came back from
the editor with its bytes changed. Without a format asked for, a file that is not valid UTF-8, or that holds
a NUL byte, is sent as base64.
*/
func (p Project) getFileModelWithContent(path, format string, withHash bool) (models.ContentModel, error) {
	osPath := p.SafePath(path)

	// Stat rather than Lstat: through a link, the size that matters is the file's.
	info, err := os.Stat(osPath)
	if err != nil {
		return models.ContentModel{}, err
	}
	if info.Size() > p.maxFileSize {
		return models.ContentModel{}, fmt.Errorf("%s is %s, and files over %s are not opened here", info.Name(), byteSize(info.Size()), byteSize(p.maxFileSize))
	}

	data, err := os.ReadFile(osPath)
	if err != nil {
		return models.ContentModel{}, err
	}

	valid := utf8.Valid(data)
	if format == "" {
		format = "text"
		if !valid || bytes.IndexByte(data, 0) >= 0 {
			format = "base64"
		}
	}

	var content string
	switch format {
	case "text":
		if !valid {
			return models.ContentModel{}, fmt.Errorf("%s cannot be read as text: %w", info.Name(), errNotText)
		}
		content = string(data)
	case "base64":
		content = base64.StdEncoding.EncodeToString(data)
	default:
		return models.ContentModel{}, fmt.Errorf("cannot read a file in format %q", format)
	}

	output := models.ContentModel{
		Name:         info.Name(),
		Path:         path,
		ContentType:  "file",
		Format:       format,
		Mimetype:     mimetypeFor(info.Name(), format == "text"),
		Content:      content,
		Created:      info.ModTime().UTC().Format(time.RFC3339),
		LastModified: info.ModTime().UTC().Format(time.RFC3339),
		Size:         info.Size()}
	if withHash {
		sum := sha256.Sum256(data)
		output.Hash = hex.EncodeToString(sum[:])
		output.HashAlgorithm = "sha256"
	}

	return output, nil
}

func mimetypeFor(name string, text bool) string {
	if mimetype := mime.TypeByExtension(filepath.Ext(name)); mimetype != "" {
		return mimetype
	}
	if text {
		return "text/plain"
	}
	return "application/octet-stream"
}

// byteSize writes a size the way a person reads one: 2.1 GB rather than 2254857830.
func byteSize(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}
