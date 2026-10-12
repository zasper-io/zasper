/*
Package runtimeinfo records each running Zasper server in ~/.zasper/runtime, so that a program on the same
machine, such as `zasper mcp`, can find the server for a project and sign in to it. Each file holds the
server's access token, so the folder and the files are the user's alone.
*/
package runtimeinfo

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Info is one running server.
type Info struct {
	URL     string `json:"url"`
	Token   string `json:"token"`
	Project string `json:"project"`
	PID     int    `json:"pid"`
}

// Dir is where the files are.
func Dir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".zasper", "runtime"), nil
}

// Write records info, answering the file's path for Remove.
func Write(info Info) (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	data, err := json.Marshal(info)
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, fmt.Sprintf("server-%d.json", info.PID))
	return path, os.WriteFile(path, data, 0o600)
}

// List answers every server recorded, including any that has since stopped without saying so.
func List() ([]Info, error) {
	dir, err := Dir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var found []Info
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), "server-") || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		var info Info
		if json.Unmarshal(data, &info) == nil && info.URL != "" {
			found = append(found, info)
		}
	}
	return found, nil
}
