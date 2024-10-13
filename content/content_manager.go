package content

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"zasper_go/core"
	"zasper_go/models"

	"github.com/rs/zerolog/log"
)

func GetContent(relativePath string, contentType string, format string, hash int) models.ContentModel {
	log.Info().Msgf("getting content for path : %s", relativePath)
	// get path info
	osPath := GetOSPath(relativePath)
	info, err := os.Lstat(osPath)

	if err != nil {
		panic(err)
	}

	var model models.ContentModel

	log.Info().Msgf("%t", info.IsDir())
	if info.IsDir() {
		model = getDirectoryModel(relativePath)
		// fmt.Println(model)
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
	log.Info().Msg("Notebook model")

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
	// output := make(map[string]interface{})
	var nb Notebook
	_ = json.Unmarshal([]byte(data), &nb)
	rejoinLines(&nb)
	stripTransient(&nb)

	return nb
}

func getDirectoryModel(relativePath string) models.ContentModel {
	log.Info().Msgf("relative path %s", relativePath)
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
	// fmt.Println(path)

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
	// log.Info().Msgf("abs  path %s", abspath)
	// log.Info().Msgf("relative  path %s", relativePath)

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
		Content:       read_file(osPath),
		Last_modified: info.ModTime().GoString(),
		Size:          info.Size()}
	return output

}

func read_file(path string) string {
	log.Info().Msgf("reading path: %s", path)
	file, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	return string(file)
}

func CreateContent(payload ContentPayload) models.ContentModel {
	if payload.ContentType == "directory" {
		return newDirectory(payload)
	}
	return newUntitled(payload)
}

func newDirectory(payload ContentPayload) models.ContentModel {

	model := models.ContentModel{}
	model.ContentType = payload.ContentType

	return model

}

func newUntitled(payload ContentPayload) models.ContentModel {

	model := models.ContentModel{}
	model.ContentType = payload.ContentType

	if payload.Extension == ".ipynb" {
		model.ContentType = "notebook"
	} else {
		model.ContentType = "file"
	}
	filename := "untitled.txt"
	model.Path = GetOSPath(filename)
	model.Name = filename
	createNewFile(model)
	return model

}

func createNewFile(model models.ContentModel) error {
	/*
		os.O_CREATE: Create the file if it does not exist.
		os.O_TRUNC: Truncate the file to zero length if it already exists.
		os.O_RDWR: Open the file for reading and writing.
	*/
	file, err := os.OpenFile(model.Path, os.O_CREATE|os.O_TRUNC|os.O_RDWR, 0666)
	if err != nil {
		return err
	}
	defer file.Close() // Ensure the file is closed when the function exits
	return nil
}

func CreateDirectory(dirPath string) error {
	err := os.Mkdir(dirPath, 0755) // 0755 is the permission mode
	if err != nil {
		if os.IsExist(err) {
			return fmt.Errorf("directory already exists: %s", dirPath)
		}
		return fmt.Errorf("error creating directory: %w", err)
	}
	return nil
}

func rename(oldName, newName string) error {
	err := os.Rename(GetOSPath(oldName), GetOSPath(newName))
	if err != nil {
		return err
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
	// Does the API-style path refer to an extant directory?

	// API-style wrapper for os.path.isdir

	// Parameters
	// ----------
	// path : str
	// The path to check. This is an API path (`/` separated,
	// relative to root_dir).

	// Returns
	// -------
	// exists : bool
	// Whether the path is indeed a directory.
	//
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
	// Given an API path, return its file system path.

	// Parameters
	// ----------
	// path : str
	// The relative API path to the named file.

	// Returns
	// -------
	// path : str
	// Native, absolute OS path to for a file.

	// Raises
	// ------
	// 404: if path is outside root

	// wdpath, err := os.Getwd()
	// if err != nil {
	// 	panic(err)
	// }

	abspath := filepath.Join(core.Zasper.HomeDir, path)
	return abspath
}

// save content

func UpdateContent(path, ftype, format, content string) error {
	err := os.WriteFile(path, []byte(content), 0644)
	if err != nil {
		log.Error().Err(err).Msg("")
		return err
	}
	return nil
}
