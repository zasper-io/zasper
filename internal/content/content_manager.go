package content

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/nbformat"

	"github.com/rs/zerolog/log"
)

func GetContent(relativePath string, contentType string, format string, hash int) (models.ContentModel, error) {
	log.Debug().Msgf("getting content for path : %s", relativePath)
	// get path info
	osPath := GetSafePath(relativePath)
	info, err := os.Lstat(osPath)

	if err != nil {
		return models.ContentModel{}, err
	}

	var model models.ContentModel

	log.Debug().Msgf("Is directory %t", info.IsDir())
	if info.IsDir() {
		model, err = getDirectoryModel(relativePath)
	} else {
		if contentType == "notebook" {
			model, err = getNotebookModel(relativePath)
		} else {
			model, err = getFileModelWithContent(relativePath)
		}

	}
	if err != nil {
		return models.ContentModel{}, err
	}

	return model, nil
}

func getNotebookModel(path string) (models.ContentModel, error) {
	osPath := GetSafePath(path)

	info, err := os.Lstat(osPath)

	if err != nil {
		return models.ContentModel{}, err
	}

	content, err := readFileContent(osPath)
	if err != nil {
		return models.ContentModel{}, err
	}

	nb, err := nbformat.Read([]byte(content))
	if err != nil {
		return models.ContentModel{}, err
	}
	for _, problem := range nbformat.Validate(nb) {
		log.Warn().Msgf("%s does not match the notebook format: %s", path, problem)
	}

	output := models.ContentModel{
		Name:          info.Name(),
		Path:          path,
		Content:       nb,
		Created:       info.ModTime().UTC().Format(time.RFC3339),
		Last_modified: info.ModTime().UTC().Format(time.RFC3339),
		Size:          info.Size()}
	return output, nil
}

func getDirectoryModel(relativePath string) (models.ContentModel, error) {
	log.Debug().Msgf("relative path %s", relativePath)
	abspath := GetSafePath(relativePath)

	info, err := os.Lstat(abspath)
	if err != nil {
		return models.ContentModel{}, err
	}

	output := models.ContentModel{
		ContentType:   "directory",
		Name:          relativePath,
		Path:          relativePath,
		Created:       info.ModTime().UTC().Format(time.RFC3339),
		Last_modified: info.ModTime().UTC().Format(time.RFC3339),
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
	ignores := ignoreMatcherFor(segments)
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

	os_path := filepath.Join(abspath, fileName)

	info, err := os.Lstat(os_path)

	if err != nil {
		log.Info().Msgf("error getting content data %s", err)
		return models.ContentModel{}, err
	}
	contentType := contentTypeFor(fileName, info.IsDir())

	path := relativePath + "/" + fileName
	if relativePath == "." {
		path = fileName
	}

	output := models.ContentModel{
		Name:          info.Name(),
		Path:          path,
		ContentType:   contentType,
		Created:       info.ModTime().UTC().Format(time.RFC3339),
		Last_modified: info.ModTime().UTC().Format(time.RFC3339),
		Size:          info.Size(),
		Writable:      isWritable(os_path, info)}
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

func getFileModelWithContent(path string) (models.ContentModel, error) {
	osPath := GetSafePath(path)

	info, err := os.Lstat(osPath)

	if err != nil {
		return models.ContentModel{}, err
	}
	fileContent, err := readFileContent(osPath)
	if err != nil {
		return models.ContentModel{}, err
	}
	output := models.ContentModel{
		Name:          info.Name(),
		Path:          path,
		Content:       fileContent,
		Created:       info.ModTime().UTC().Format(time.RFC3339),
		Last_modified: info.ModTime().UTC().Format(time.RFC3339),
		Size:          info.Size()}

	return output, nil
}

func readFileContent(path string) (string, error) {
	fileName := filepath.Base(path)
	extension := filepath.Ext(fileName)
	log.Debug().Msgf("reading path extension: %s", extension)
	log.Debug().Msgf("reading path: %s", path)

	file, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	if extension == ".png" {
		return "data:image/png;base64," + base64.StdEncoding.EncodeToString(file), nil
	}

	return string(file), nil
}

/*
Creating something can fail — a read-only filesystem, a full disk, a parent directory that has just
gone — and the client shows the new row by the path in the answer, so a failure that answered 200
with a model for a file that is not there left the panel lying.
*/
func createContent(payload ContentPayload) (models.ContentModel, error) {
	switch payload.ContentType {
	case "notebook":
		return newUntitledNotebook(payload)
	case "directory":
		return CreateDirectory(payload)
	default:
		return newUntitledFile(payload)
	}
}

// pathExists is about anything answering to the path, a broken symlink included: a name is free only
// when nothing at all is there.
func pathExists(osPath string) bool {
	_, err := os.Lstat(osPath)
	return err == nil
}

// availableName returns the first candidate that names nothing in osDir. Racy by nature, which is
// why the creators still open with O_EXCL rather than trusting the answer.
func availableName(osDir string, candidate func(attempt int) string) string {
	for attempt := 0; ; attempt++ {
		name := candidate(attempt)
		if !pathExists(filepath.Join(osDir, name)) {
			return name
		}
	}
}

// numbered names the first attempt plainly and every later one with a number, which is how both
// Jupyter's `Untitled1.ipynb` and this project's `untitled-directory-1` are spelled.
func numbered(base, separator, ext string) func(int) string {
	return func(attempt int) string {
		if attempt == 0 {
			return base + ext
		}
		return fmt.Sprintf("%s%s%d%s", base, separator, attempt, ext)
	}
}

// createdModel describes what was just written, from the file itself rather than from what was asked
// for: the path is project-relative like every other path in the API, since the client looks the new
// row up in the listing by it, and the name is the one that was free.
func createdModel(contentType, parentDir, name, osPath string) (models.ContentModel, error) {
	info, err := os.Lstat(osPath)
	if err != nil {
		return models.ContentModel{}, err
	}

	return models.ContentModel{
		ContentType:   contentType,
		Path:          filepath.Join(parentDir, name),
		Name:          name,
		Created:       info.ModTime().UTC().Format(time.RFC3339),
		Last_modified: info.ModTime().UTC().Format(time.RFC3339),
		Size:          info.Size(),
		// Asked rather than assumed: a directory listing reports this, so an entry that has just been
		// created should describe itself the same way rather than claiming to be read-only.
		Writable: isWritable(osPath, info),
	}, nil
}

func newUntitledFile(payload ContentPayload) (models.ContentModel, error) {
	parentDir, err := safeWritePath(payload.ParentDir)
	if err != nil {
		return models.ContentModel{}, err
	}

	name := availableName(parentDir, numbered("untitled", "", ".txt"))
	osPath := filepath.Join(parentDir, name)

	// O_EXCL rather than O_TRUNC: availableName looked a moment ago, and truncating a file that has
	// appeared since would destroy it.
	file, err := os.OpenFile(osPath, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0644)
	if err != nil {
		return models.ContentModel{}, err
	}
	if err := file.Close(); err != nil {
		return models.ContentModel{}, err
	}

	return createdModel(payload.ContentType, payload.ParentDir, name, osPath)
}

func newUntitledNotebook(payload ContentPayload) (models.ContentModel, error) {
	parentDir, err := safeWritePath(payload.ParentDir)
	if err != nil {
		return models.ContentModel{}, err
	}

	defaultNotebook, err := nbformat.Marshal(nbformat.New())
	if err != nil {
		return models.ContentModel{}, fmt.Errorf("building the default notebook: %w", err)
	}

	name := availableName(parentDir, numbered("Untitled", "", ".ipynb"))
	osPath := filepath.Join(parentDir, name)

	file, err := os.OpenFile(osPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err != nil {
		return models.ContentModel{}, err
	}
	if _, err := file.Write(defaultNotebook); err != nil {
		file.Close()
		return models.ContentModel{}, err
	}
	if err := file.Close(); err != nil {
		return models.ContentModel{}, err
	}

	return createdModel(payload.ContentType, payload.ParentDir, name, osPath)
}

func CreateDirectory(payload ContentPayload) (models.ContentModel, error) {
	parentDir, err := safeWritePath(payload.ParentDir)
	if err != nil {
		return models.ContentModel{}, err
	}

	name := availableName(parentDir, numbered("untitled-directory", "-", ""))
	osPath := filepath.Join(parentDir, name)
	if err := os.Mkdir(osPath, 0755); err != nil {
		return models.ContentModel{}, err
	}

	return createdModel(payload.ContentType, payload.ParentDir, name, osPath)
}

// errTargetExists is what a rename or a move onto an existing sibling gives back, so the handler can
// answer with a conflict rather than a generic failure.
var errTargetExists = errors.New("a file or folder with that name already exists")

// errIntoItself is a folder moved or copied into its own subtree, which would either be refused by
// the kernel with a bare EINVAL or, for a copy, recurse until the disk filled.
var errIntoItself = errors.New("a folder cannot be moved or copied inside itself")

// isInside reports whether osPath is the folder itself or something under it, segment by segment
// rather than by string prefix: `.../projectX-secrets` is not inside `.../projectX`.
func isInside(osPath, folder string) bool {
	if osPath == folder {
		return true
	}
	return strings.HasPrefix(osPath, strings.TrimSuffix(folder, string(os.PathSeparator))+string(os.PathSeparator))
}

func rename(parentDir, oldName, newName string) error {
	if strings.TrimSpace(newName) == "" {
		return errors.New("a name is required")
	}

	// A rename names a sibling. A path here would move the file somewhere else, which is what the
	// move endpoint is for, and the inline rename box does not read like it can do that.
	if strings.ContainsAny(newName, `/\`) {
		return errors.New("a name cannot contain a path separator")
	}

	return moveContent(filepath.Join(parentDir, oldName), filepath.Join(parentDir, newName))
}

// moveContent moves a file or folder to another project-relative path, which is both a rename and
// what a drag between folders or a cut-and-paste does.
func moveContent(from, to string) error {
	if strings.TrimSpace(to) == "" {
		return errors.New("a destination is required")
	}

	source, err := safeWritePath(from)
	if err != nil {
		return err
	}
	target, err := safeWritePath(to)
	if err != nil {
		return err
	}

	if _, err := os.Lstat(source); err != nil {
		return err
	}
	if source == target {
		return nil
	}
	if isInside(target, source) {
		return errIntoItself
	}
	// os.Rename replaces an existing target without a word, which for a file browser means a
	// mistyped name destroys a sibling.
	if pathExists(target) {
		return errTargetExists
	}
	// Said plainly, because os.Rename answers a missing destination folder with the same ENOENT it
	// answers a missing source with.
	if !pathExists(filepath.Dir(target)) {
		return fmt.Errorf("there is no folder %s to move into", filepath.Dir(to))
	}

	return os.Rename(source, target)
}

/*
copyContent copies a file or folder into toDir under a free name, which covers duplicating in place
(toDir being where it already is) as well as pasting elsewhere. The name it took is in the answer,
since the client has no way to predict it.
*/
func copyContent(from, toDir string) (models.ContentModel, error) {
	source, err := safeWritePath(from)
	if err != nil {
		return models.ContentModel{}, err
	}
	targetDir, err := safeWritePath(toDir)
	if err != nil {
		return models.ContentModel{}, err
	}

	info, err := os.Lstat(source)
	if err != nil {
		return models.ContentModel{}, err
	}
	dirInfo, err := os.Stat(targetDir)
	if err != nil {
		return models.ContentModel{}, err
	}
	if !dirInfo.IsDir() {
		return models.ContentModel{}, fmt.Errorf("%s is not a folder", toDir)
	}
	if info.IsDir() && isInside(targetDir, source) {
		return models.ContentModel{}, errIntoItself
	}

	name := availableName(targetDir, copyOf(info.Name(), info.IsDir()))
	target := filepath.Join(targetDir, name)

	if info.IsDir() {
		err = copyTree(source, target)
	} else {
		err = copyEntry(source, target, info)
	}
	if err != nil {
		// A copy that failed halfway leaves a partial tree behind, which is worse than no copy: it
		// looks like a complete one.
		if removeErr := os.RemoveAll(target); removeErr != nil {
			log.Error().Err(removeErr).Msgf("Failed to clean up the partial copy at %s", target)
		}
		return models.ContentModel{}, err
	}

	return createdModel(contentTypeFor(name, info.IsDir()), toDir, name, target)
}

// copyOf keeps the name it was given when that name is free, and otherwise spells the copy the way
// Jupyter does — `notes-Copy1.txt`, then -Copy2. So a copy into another folder arrives under its own
// name and only a duplicate in place, where the name is by definition taken, is renamed. A folder's
// name is left whole, since the part after a dot in `my.project` is not an extension.
func copyOf(name string, isDir bool) func(int) string {
	ext := ""
	if !isDir {
		ext = filepath.Ext(name)
	}
	stem := strings.TrimSuffix(name, ext)

	return func(attempt int) string {
		if attempt == 0 {
			return name
		}
		return fmt.Sprintf("%s-Copy%d%s", stem, attempt, ext)
	}
}

func copyTree(source, target string) error {
	return filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(target, relative)

		if info.IsDir() {
			return os.MkdirAll(destination, info.Mode().Perm())
		}
		return copyEntry(path, destination, info)
	})
}

func copyEntry(source, target string, info os.FileInfo) error {
	if info.Mode()&os.ModeSymlink != 0 {
		// Reproduced as the link it is: following it would pull in whatever it points at, which may be
		// outside the project entirely.
		link, err := os.Readlink(source)
		if err != nil {
			return err
		}
		return os.Symlink(link, target)
	}
	if !info.Mode().IsRegular() {
		// A socket or a device node is not something to reproduce, and skipping one beats failing the
		// whole copy over it.
		log.Warn().Msgf("Skipping %s while copying: not a regular file", source)
		return nil
	}

	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()

	// O_EXCL: availableName picked a name nothing answered to, and a copy is never meant to land on
	// top of something.
	out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}

	return out.Close()
}

/*
uploadContent writes one uploaded file into the project and describes what it wrote.

`relativePath` is the file's path *within* parentDir, which is how a whole folder arrives: the browser
hands over `notes/img/logo.png` for a dropped `notes` folder, one request per file, and the folders
along the way are made here. It is the browser's own string, so it is checked rather than trusted.

The body is written to a temporary file beside the target and renamed into place, so an upload that is
cancelled or drops halfway leaves nothing behind, and one that is replacing a file does not truncate
it until every byte has arrived.
*/
func uploadContent(parentDir, relativePath string, replace bool, body io.Reader) (models.ContentModel, error) {
	fromBrowser := filepath.FromSlash(relativePath)
	relative := filepath.Clean(fromBrowser)
	name := filepath.Base(relative)
	// A trailing separator survives neither Clean nor Base, and it means the browser named a folder.
	if filepath.IsAbs(relative) || name == "." || strings.HasSuffix(fromBrowser, string(os.PathSeparator)) {
		return models.ContentModel{}, fmt.Errorf("%s is not a file name", relativePath)
	}

	// Under parentDir, and confirmed to still be inside the project after the join: `..` in the
	// browser's string is the whole reason this is not filepath.Join on its own.
	targetDir, err := safeWritePath(filepath.Join(parentDir, filepath.Dir(relative)))
	if err != nil {
		return models.ContentModel{}, err
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return models.ContentModel{}, err
	}

	target := filepath.Join(targetDir, name)
	if !replace && pathExists(target) {
		return models.ContentModel{}, errTargetExists
	}

	temporary, err := os.CreateTemp(targetDir, ".zasper-upload-*")
	if err != nil {
		return models.ContentModel{}, err
	}
	written, err := io.Copy(temporary, body)
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporary.Name(), target)
	}
	if err != nil {
		if removeErr := os.Remove(temporary.Name()); removeErr != nil && !os.IsNotExist(removeErr) {
			log.Error().Err(removeErr).Msgf("Failed to clean up the partial upload at %s", temporary.Name())
		}
		return models.ContentModel{}, err
	}

	// 0600 is what CreateTemp makes; an uploaded file should read like one that was created here.
	if err := os.Chmod(target, 0o644); err != nil {
		log.Warn().Err(err).Msgf("Uploaded %s but could not set its mode", target)
	}
	log.Debug().Msgf("Uploaded %d bytes to %s", written, target)

	return createdModel(
		contentTypeFor(name, false),
		filepath.Join(parentDir, filepath.Dir(relative)),
		name,
		target,
	)
}

func deleteFile(filename string) error {
	// Via the same helper as the writes, so a rejected path says why rather than failing as
	// `remove : no such file or directory`.
	osPath, err := safeWritePath(filename)
	if err != nil {
		return err
	}

	info, err := os.Lstat(osPath)
	if err != nil {
		return err
	}

	// RemoveAll for a directory, because the UI offers "Delete Folder" and os.Remove refuses a
	// non-empty one. Kept off files so that deleting one that has already gone still says so.
	if info.IsDir() {
		return os.RemoveAll(osPath)
	}
	return os.Remove(osPath)
}

func IsDir(path string) bool {
	info, err := os.Lstat(path)

	if err != nil {
		log.Info().Msgf("error getting content data %s", err)
	}
	return info.IsDir()
}

func GetSafePath(path string) string {
	// Resolved, because the containment check below compares strings and HomeDir is whatever came
	// in on -cwd: a relative one would make every path look like an escape.
	homeDir, err := filepath.Abs(core.Zasper.HomeDir)
	if err != nil {
		log.Printf("Error resolving home directory %s: %v", core.Zasper.HomeDir, err)
		return ""
	}

	// Clean the path to remove any directory traversal components
	cleanPath := filepath.Clean(path)
	abspath := filepath.Join(homeDir, cleanPath)

	absPathResolved, err := filepath.Abs(abspath)
	if err != nil {
		log.Printf("Error resolving absolute path: %v", err)
		return ""
	}

	// The separator matters: a plain prefix test lets `../projectX-secrets` out of `.../projectX`.
	prefix := strings.TrimSuffix(homeDir, string(os.PathSeparator)) + string(os.PathSeparator)
	if absPathResolved != homeDir && !strings.HasPrefix(absPathResolved, prefix) {
		log.Printf("Warning: Path traversal detected. The path %s is outside the allowed directory %s", absPathResolved, homeDir)
		return ""
	}

	return absPathResolved
}

/*
Writes have to be rooted the same way reads are. GetSafePath is what confines a path to the project
directory; without it a relative path resolves against the server process's working directory
instead.
*/
func safeWritePath(path string) (string, error) {
	osPath := GetSafePath(path)
	if osPath == "" {
		return "", fmt.Errorf("path %s is outside the project directory", path)
	}
	return osPath, nil
}

func UpdateNbContent(path, ftype, format string, content interface{}) error {
	log.Info().Msgf("Updating notebook content for path: %s", path)

	osPath, err := safeWritePath(path)
	if err != nil {
		return err
	}

	// Convert content to JSON if it's a string or []byte, otherwise directly marshal it
	var contentBytes []byte

	switch v := content.(type) {
	case string:
		// If content is a string, assume it's JSON and convert it to []byte
		contentBytes = []byte(v)
	case []byte:
		// If content is already []byte, assume it's JSON
		contentBytes = v
	case map[string]interface{}:
		// If content is already a map, we can directly marshal it into the notebook
		contentBytes, err = json.Marshal(content)
		if err != nil {
			return fmt.Errorf("failed to marshal map content into JSON: %w", err)
		}
	default:
		// If the content is an unsupported type
		return fmt.Errorf("content is not a valid type (expected string, []byte, or map[string]interface{}), got: %T", content)
	}

	// The editor sends the notebook back in the form it received it, so no line joining here.
	nb, err := nbformat.Unmarshal(contentBytes)
	if err != nil {
		return fmt.Errorf("failed to unmarshal content into notebook: %w", err)
	}

	// Checked as it will be written, not as the editor sent it: Normalize takes back out what the
	// editor added, so what is left is a problem in the document itself. Reported and not refused,
	// because a save is the wrong moment to decline to keep someone's work.
	disk := nbformat.Normalize(nb)
	for _, problem := range nbformat.Validate(disk) {
		log.Warn().Msgf("saving %s with something the notebook format does not allow: %s", path, problem)
	}

	nbJSON, err := nbformat.Marshal(disk)
	if err != nil {
		return fmt.Errorf("failed to marshal notebook: %w", err)
	}

	log.Debug().Msgf("nbJSON: %s", string(nbJSON))

	// Write the JSON back to the file
	if err := os.WriteFile(osPath, nbJSON, 0644); err != nil {
		log.Error().Err(err).Msgf("Error updating notebook content for path: %s", osPath)
		return fmt.Errorf("error writing notebook to path %s: %w", path, err)
	}

	log.Info().Msgf("Successfully updated notebook content for path: %s", osPath)
	return nil
}

func UpdateContent(path, ftype, format, content string) error {
	osPath, err := safeWritePath(path)
	if err != nil {
		return err
	}

	err = os.WriteFile(osPath, []byte(content), 0644)
	if err != nil {
		log.Error().Err(err).Msg("")
		return err
	}
	return nil
}
