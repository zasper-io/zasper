package content

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/zasper-io/zasper/core"
	"github.com/zasper-io/zasper/models"

	"github.com/rs/zerolog/log"
)

func GetContent(relativePath string, contentType string, format string, hash int) models.ContentModel {
	log.Debug().Msgf("getting content for path : %s", relativePath)
	// get path info
	osPath := GetOSPath(relativePath)
	info, err := os.Lstat(osPath)

	if err != nil {
		panic(err)
	}

	var model models.ContentModel

	log.Debug().Msgf("Is directory %t", info.IsDir())
	if info.IsDir() {
		model = getDirectoryModel(relativePath)
	} else {
		if contentType == "notebook" {
			model = getNotebookModel(relativePath)
		} else {
			model = getFileModelWithContent(relativePath)
		}

	}

	return model
}

func getNotebookModel(path string) models.ContentModel {

	// fmt.Println(path)
	osPath := GetOSPath(path)

	info, err := os.Lstat(osPath)

	if err != nil {
		panic(err)
	}

	content := read_file(osPath)

	as_version := 4
	capture_validation_error := false

	nb := nbformatReads(
		content,
		as_version,
		capture_validation_error,
	)

	output := models.ContentModel{
		Name:          info.Name(),
		Path:          path,
		Content:       nb,
		Last_modified: info.ModTime().GoString(),
		Size:          info.Size()}
	return output
}

func nbformatReads(data string, version int, capture_validation_error bool) Notebook {
	var nb NotebookDisk
	_ = json.Unmarshal([]byte(data), &nb)
	output := parseNotebook(nb)

	return output
}

func getDirectoryModel(relativePath string) models.ContentModel {
	log.Debug().Msgf("relative path %s", relativePath)
	abspath := GetOSPath(relativePath)

	info, err := os.Lstat(abspath)
	if err != nil {
		panic(err)
	}

	output := models.ContentModel{
		ContentType:   "directory",
		Name:          relativePath,
		Path:          relativePath,
		Last_modified: info.ModTime().GoString(),
	}

	dir, err := os.Open(abspath)
	if err != nil {
		panic(err)
	}
	files, err := dir.Readdir(0)
	if err != nil {
		fmt.Println(err)
	}
	listOfContents := []models.ContentModel{}
	for _, v := range files {

		listOfContents = append(listOfContents, getFileModel(abspath, relativePath, v.Name()))

	}
	sort.Sort(models.ByContentTypeAndName(listOfContents))
	output.Content = listOfContents
	return output
}

func getFileModel(abspath, relativePath, fileName string) models.ContentModel {

	os_path := filepath.Join(abspath, fileName)

	info, err := os.Lstat(os_path)

	if err != nil {
		panic(err)
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
		Last_modified: info.ModTime().GoString(),
		Size:          info.Size()}
	return output

}

func getFileModelWithContent(path string) models.ContentModel {
	// fmt.Println(path)
	osPath := GetOSPath(path)

	info, err := os.Lstat(osPath)

	if err != nil {
		panic(err)
	}

	output := models.ContentModel{
		Name:          info.Name(),
		Path:          path,
		Content:       read_file2(osPath, info.Name()),
		Last_modified: info.ModTime().GoString(),
		Size:          info.Size()}
	return output

}

func read_file2(path string, fileName string) string {
	extension := filepath.Ext(fileName)
	log.Debug().Msgf("reading path extension: %s", extension)
	log.Debug().Msgf("reading path: %s", path)
	file, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	if extension == ".png" {
		return "data:image/png;base64," + base64.StdEncoding.EncodeToString(file)
	}
	return string(file)
}

func read_file(path string) string {
	log.Debug().Msgf("reading path: %s", path)
	file, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	return string(file)
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

	model := models.ContentModel{}
	model.ContentType = payload.ContentType

	filePath := GetOSPath(payload.ParentDir + "/" + "untitled.txt")

	// Check if the file already exists and if so, increment the file number
	i := 0
	for fileExists(filePath) {
		i++
		// Generate a new filename like "untitled-1.txt", "untitled-2.txt", etc.
		filePath = GetOSPath(payload.ParentDir + "/" + fmt.Sprintf("untitled-%d.txt", i))
	}

	// Create the file with the unique filename
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_TRUNC|os.O_RDWR, 0755)
	if err != nil {
		log.Info().Msgf("Error creating file: %s", err)
	}
	defer file.Close() // Ensure the file is closed when the function exits

	// Update the model to use the new path and name
	model.Path = filePath
	model.Name = filepath.Base(filePath)

	return model
}

func newUntitledNotebook(payload ContentPayload) models.ContentModel {
	/*
		os.O_CREATE: Create the file if it does not exist.
		os.O_TRUNC: Truncate the file to zero length if it already exists.
		os.O_RDWR: Open the file for reading and writing.
	*/
	model := models.ContentModel{}
	model.ContentType = payload.ContentType

	filePath := GetOSPath(payload.ParentDir + "/" + "untitled.ipynb")

	// Check if the file already exists and if so, increment the file number
	i := 0
	for fileExists(filePath) {
		i++
		// Generate a new filename like "untitled-1.txt", "untitled-2.txt", etc.
		filePath = GetOSPath(payload.ParentDir + "/" + fmt.Sprintf("untitled-%d.ipynb", i))
	}

	// Create the file with the unique filename
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_TRUNC|os.O_RDWR, 0755)
	if err != nil {
		log.Info().Msgf("Error creating file: %s", err)
	}
	defer file.Close() // Ensure the file is closed when the function exits

	// Update the model to use the new path and name
	model.Path = filePath
	model.Name = filepath.Base(filePath)

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
	dirPath := GetOSPath(payload.ParentDir + "/" + dirName)
	for directoryExists(dirPath) {
		i++
		dirPath = GetOSPath(payload.ParentDir + "/" + fmt.Sprintf("%s-%d", dirName, i))
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
	err := os.Rename(GetOSPath(parentDir+"/"+oldName), GetOSPath(parentDir+"/"+newName))
	if err != nil {
		log.Info().Msgf("error is %s", err)
	}
	return nil
}

func deleteFile(filename string) error {
	err := os.Remove(GetOSPath(filename))
	if err != nil {
		return err
	}
	return nil
}

func GetKernelPath(path string) int {
	return 1
}

func dirExists(path string) bool {
	path = filepath.Clean(path)
	os_path := GetOSPath(path)
	return IsDir(os_path)
}

func IsDir(path string) bool {
	info, err := os.Lstat(path)

	if err != nil {
		panic(err)
	}
	return info.IsDir()
}

func GetOSPath(path string) string {
	abspath := filepath.Join(core.Zasper.HomeDir, path)
	return abspath
}

func UpdateNbContent(path, ftype, format string, content interface{}) error {
	var nb Notebook
	log.Info().Msgf("Updating notebook content for path: %s", path)

	// Convert content to JSON if it's a string or []byte, otherwise directly marshal it
	var contentBytes []byte
	var err error

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

	// Unmarshal the JSON bytes into the Notebook struct
	if err := json.Unmarshal(contentBytes, &nb); err != nil {
		return fmt.Errorf("failed to unmarshal content into notebook: %w", err)
	}

	newNb := convertToNbDisk(nb)

	// Marshal the notebook struct back into JSON (to save the updated notebook)
	nbJSON, err := json.MarshalIndent(newNb, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal notebook: %w", err)
	}

	log.Info().Msgf("nbJSON: %s", string(nbJSON))

	// Write the JSON back to the file
	if err := os.WriteFile(path, nbJSON, 0644); err != nil {
		log.Error().Err(err).Msgf("Error updating notebook content for path: %s", path)
		return fmt.Errorf("error writing notebook to path %s: %w", path, err)
	}

	log.Info().Msgf("Successfully updated notebook content for path: %s", path)
	return nil
}

func UpdateContent(path, ftype, format, content string) error {
	err := os.WriteFile(path, []byte(content), 0644)
	if err != nil {
		log.Error().Err(err).Msg("")
		return err
	}
	return nil
}
