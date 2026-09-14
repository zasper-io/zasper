// Package core holds what the server starts with: the project it serves, the user running it and the
// access token that guards it.
package core

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"

	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/kernelspec/jupyterpaths"
)

var Zasper Application

var ServerAccessToken string

func GenerateRandomToken(n int) (string, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

type Application struct {
	UserName string
	// The project directory, as an absolute path.
	HomeDir     string
	JupyterPath []string
	ProjectName string
	OSName      string
	Version     string
}

func SetUpZasper(version string, cwd string) Application {
	// Absolute, so the project is where --cwd said when it was given, whatever the process's working
	// directory is later.
	projectDir, err := filepath.Abs(cwd)
	if err != nil {
		log.Fatal().Err(err).Msgf("could not resolve the project directory %s", cwd)
	}

	// Pinned for a hosted server whose users keep a link, and for the e2e suite, which has to sign in.
	ServerAccessToken = os.Getenv("ZASPER_ACCESS_TOKEN")
	if ServerAccessToken == "" {
		ServerAccessToken, err = GenerateRandomToken(16) // 16 bytes = 32 hex characters
		if err != nil {
			log.Fatal().Msgf("Failed to generate access token: %v", err)
		}
	}

	return Application{
		ProjectName: filepath.Base(projectDir),
		HomeDir:     projectDir,
		Version:     version,
		UserName:    GetUsername(),
		OSName:      runtime.GOOS,
		JupyterPath: jupyterpaths.Dirs(),
	}
}

// GetUsername answers the name of the account running Zasper, from the environment.
func GetUsername() string {
	if runtime.GOOS == "windows" {
		return os.Getenv("USERNAME")
	}
	return os.Getenv("USER")
}
