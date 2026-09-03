package content

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
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
		log.Info().Msgf("error getting content data %s", err)
	}
	files, err := dir.Readdir(0)
	if err != nil {
		log.Error().Msgf("error getting content data %s", err)
	}
	listOfContents := []models.ContentModel{}
	for _, v := range files {
		fileContent, _ := getFileModel(abspath, relativePath, v.Name())
		if err != nil {
			log.Info().Msgf("error getting content data %s", err)
			continue
		}
		listOfContents = append(listOfContents, fileContent)
	}
	sort.Sort(models.ByContentTypeAndName(listOfContents))
	output.Content = listOfContents
	return output, nil
}

func getFileModel(abspath, relativePath, fileName string) (models.ContentModel, error) {

	os_path := filepath.Join(abspath, fileName)

	info, err := os.Lstat(os_path)

	if err != nil {
		log.Info().Msgf("error getting content data %s", err)
		return models.ContentModel{}, err
	}
	extension := filepath.Ext(fileName)
	contentType := "file"
	if extension == ".ipynb" {
		contentType = "notebook"
	}
	if info.IsDir() {
		contentType = "directory"
	}

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
		Size:          info.Size()}
	return output, nil

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

func createContent(payload ContentPayload) models.ContentModel {
	if payload.ContentType == "notebook" {
		return newUntitledNotebook(payload)
	} else if payload.ContentType == "directory" {
		return CreateDirectory(payload)
	} else {
		return newUntitledFile(payload)
	}

}

// Function to check if the file exists
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return !os.IsNotExist(err)
}

// Modify the newUntitledFile function to create untitled-1.txt, untitled-2.txt, etc.
func newUntitledFile(payload ContentPayload) models.ContentModel {

	parentDir := GetSafePath(payload.ParentDir)

	fileNameWithPath := filepath.Join(parentDir, "untitled.txt")

	// Check if the file already exists and if so, increment the file number
	i := 0
	for fileExists(fileNameWithPath) {
		i++
		// Generate a new filename like "untitled-1.txt", "untitled-2.txt", etc.
		fileNameWithPath = filepath.Join(parentDir, fmt.Sprintf("untitled%d.txt", i))
	}

	// Create the file with the unique filename
	file, err := os.OpenFile(fileNameWithPath, os.O_CREATE|os.O_TRUNC|os.O_RDWR, 0644)
	if err != nil {
		log.Info().Msgf("Error creating file: %s", err)
	}
	defer file.Close() // Ensure the file is closed when the function exits

	info, err := os.Lstat(fileNameWithPath)

	if err != nil {
		log.Info().Msgf("error getting content data %s", err)
	}

	// Update the model to use the new path and name
	fileName := filepath.Base(fileNameWithPath)
	model := models.ContentModel{
		ContentType:   payload.ContentType,
		Path:          filepath.Join(payload.ParentDir, fileName),
		Name:          fileName,
		Created:       info.ModTime().UTC().Format(time.RFC3339),
		Last_modified: info.ModTime().UTC().Format(time.RFC3339),
		Size:          info.Size(),
	}

	return model
}

func newUntitledNotebook(payload ContentPayload) models.ContentModel {
	/*
		os.O_CREATE: Create the file if it does not exist.
		os.O_TRUNC: Truncate the file to zero length if it already exists.
		os.O_RDWR: Open the file for reading and writing.
	*/

	parentDir := GetSafePath(payload.ParentDir)

	fileNameWithPath := filepath.Join(parentDir, "Untitled.ipynb")

	// Check if the file already exists and if so, increment the file number
	i := 0
	for fileExists(fileNameWithPath) {
		i++
		// Generate a new filename like "untitled-1.txt", "untitled-2.txt", etc.
		fileNameWithPath = filepath.Join(parentDir, fmt.Sprintf("Untitled%d.ipynb", i))
	}

	log.Debug().Msgf("Creating new untitled notebook at fileNameWithPath: %s", fileNameWithPath)

	// Create the file with the unique filename
	file, err := os.OpenFile(fileNameWithPath, os.O_CREATE|os.O_TRUNC|os.O_RDWR, 0644)
	if err != nil {
		log.Info().Msgf("Error creating file: %s", err)
	}
	defer file.Close() // Ensure the file is closed when the function exits

	// Write the default notebook content to the file
	defaultNotebook, err := nbformat.Marshal(nbformat.New())
	if err != nil {
		log.Error().Err(err).Msg("Error building the default notebook content")
	}

	err = os.WriteFile(fileNameWithPath, defaultNotebook, 0644)
	if err != nil {
		log.Error().Err(err).Msgf("Error writing default notebook content to file: %s", fileNameWithPath)
	}

	info, err := os.Lstat(fileNameWithPath)

	if err != nil {
		log.Info().Msgf("error getting content data %s", err)
	}

	// Update the model to use the new path and name
	fileName := filepath.Base(fileNameWithPath)
	model := models.ContentModel{
		ContentType:   payload.ContentType,
		Path:          filepath.Join(payload.ParentDir, fileName),
		Name:          fileName,
		Created:       info.ModTime().UTC().Format(time.RFC3339),
		Last_modified: info.ModTime().UTC().Format(time.RFC3339),
		Size:          info.Size(),
	}

	return model
}

// Function to check if a directory exists
func directoryExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}

func CreateDirectory(payload ContentPayload) models.ContentModel {
	model := models.ContentModel{}
	model.ContentType = payload.ContentType
	dirName := "untitled-directory"
	i := 0
	dirPath := GetSafePath(filepath.Join(payload.ParentDir, dirName))
	for directoryExists(dirPath) {
		i++
		dirPath = GetSafePath(filepath.Join(payload.ParentDir, fmt.Sprintf("%s-%d", dirName, i)))
	}

	// Create the directory with the unique name
	err := os.MkdirAll(dirPath, 0755)
	if err != nil {
		log.Info().Msgf("Error creating directory: %s", err)
	}
	model.Path = dirPath
	model.Name = filepath.Base(dirName)

	return model
}

func rename(parentDir, oldName, newName string) error {
	err := os.Rename(GetSafePath(filepath.Join(parentDir, oldName)), GetSafePath(filepath.Join(parentDir, newName)))
	if err != nil {
		log.Info().Msgf("error is %s", err)
	}
	return nil
}

func deleteFile(filename string) error {
	// Via the same helper as the writes, so a rejected path says why rather than failing as
	// `remove : no such file or directory`.
	osPath, err := safeWritePath(filename)
	if err != nil {
		return err
	}

	if err := os.Remove(osPath); err != nil {
		return err
	}
	return nil
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
