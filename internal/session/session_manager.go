package session

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/models"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

func ListSessions() map[string]models.SessionModel {
	return core.ListSessions()
}

// CreateSession starts a session on a new kernel, or answers with the one the file is already running
// on: see runningSessionFor.
func CreateSession(req models.SessionModel) (models.SessionModel, error) {
	log.Debug().Msgf("creating session %s", req.Kernel.Name)

	if session, ok := runningSessionFor(req); ok {
		log.Debug().Msgf("session %s is already running %s", session.Id, session.Path)
		return session, nil
	}

	kernelId, err := startKernelForSession(req.Path, req.Kernel.Name)
	if err != nil {
		return models.SessionModel{}, err
	}
	log.Debug().Msgf("started kernel with id %s", kernelId)

	session_id := uuid.New().String()
	session := models.SessionModel{
		Id:          session_id,
		Name:        req.Name,
		SessionType: req.SessionType,
		Path:        req.Path,
		Kernel: models.KernelModel{
			Id:             kernelId,
			Name:           req.Kernel.Name,
			LastActivity:   time.Now().UTC().String(),
			ExecutionState: "",
			Connections:    0,
		},
	}
	// Written after the kernel is up, and outside any lock: starting one takes as long as it takes,
	// and nothing else can read this session before it exists.
	core.SetSession(session_id, session)

	return session, nil
}

/*
runningSessionFor finds the session a request is asking to join rather than to start: the one it names
by id, or the one already running the same file on the same kernel.

Joining is Jupyter's own answer to a second request for a notebook that is running, and what lets a
page that has been reloaded pick up where it was — the kernel still holds the state the notebook was
built on, including the widgets in its outputs. Without it a reload starts a second kernel on the same
notebook and abandons the first.
*/
func runningSessionFor(req models.SessionModel) (models.SessionModel, bool) {
	if session, ok := core.GetSession(req.Id); ok {
		return session, true
	}

	session, ok := core.SessionForPath(req.Path, req.Kernel.Name)
	if !ok {
		return models.SessionModel{}, false
	}
	if _, alive := kernel.ActiveKernel(session.Kernel.Id); !alive {
		// The session outlived its kernel, which died on its own or was killed from outside. Nothing
		// can be run on it, so it goes rather than shadowing the session about to replace it.
		log.Info().Msgf("session %s outlived its kernel; dropping it", session.Id)
		core.RemoveSession(session.Id)
		return models.SessionModel{}, false
	}
	return session, true
}

func DeleteSession(req models.SessionModel) error {
	/*
		Deletes a Sesion
	*/
	log.Info().Msgf("deleting session %s", req.Id)
	// Taken out first, and the kernel stopped only by whoever took it out: two requests deleting the
	// same session would otherwise both stop the kernel, and both be told it worked.
	session, ok := core.RemoveSession(req.Id)
	if !ok {
		log.Info().Msg("session does not exist")
		return fmt.Errorf("session %s does not exist", req.Id)
	}
	stopKernelForSession(session.Kernel.Id)
	return nil
}

/*
RelocateSessions follows a renamed or moved file through the sessions, so the session list stops
naming a path that no longer exists and a lookup by path still finds the kernel. A running kernel's
own working directory cannot be changed, so this is the record catching up rather than the kernel
moving; oldPath may be a folder, in which case every session under it follows.
*/
func RelocateSessions(oldPath, newPath string) int {
	relocated := core.UpdateSessions(func(session models.SessionModel) (models.SessionModel, bool) {
		moved, ok := relocate(session.Path, oldPath, newPath)
		if !ok {
			return session, false
		}
		if session.Name == filepath.Base(session.Path) {
			session.Name = filepath.Base(moved)
		}
		session.Path = moved
		return session, true
	})

	if relocated > 0 {
		log.Info().Msgf("Moved %d session(s) from %s to %s", relocated, oldPath, newPath)
	}
	return relocated
}

// relocate rewrites a path that is oldPath or sits under it, by segments rather than by prefix so
// that `notes2.txt` does not follow `notes.txt`.
func relocate(path, oldPath, newPath string) (string, bool) {
	if path == oldPath {
		return newPath, true
	}
	if prefix := oldPath + "/"; strings.HasPrefix(path, prefix) {
		return newPath + "/" + strings.TrimPrefix(path, prefix), true
	}
	return "", false
}

func startKernelForSession(path string, name string) (string, error) {
	/*
		Starts a Jupyter Kernel for a new Sesion
	*/
	env := getKernelEnv(path, name)
	log.Debug().Msg("starting kernel")
	kernelId, err := kernel.StartKernelManager(path, name, env)
	if err != nil {
		return "", err
	}
	return kernelId, nil
}

func stopKernelForSession(kernelId string) {
	/*
		Stops a Jupyter Kernel for a Sesion
	*/
	if err := kernel.StopKernelManager(kernelId); err != nil {
		// The session is torn down regardless: its kernel is already gone.
		log.Error().Msgf("Error stopping kernel %s: %v", kernelId, err)
	}
}

func getKernelEnv(path string, name string) map[string]string {
	/*
		Get Kernel Environment variables
	*/
	// if name != nil
	cwd := kernel.CwdForPath(path)
	path = filepath.Join(cwd, name)
	env := make(map[string]string)
	env["JPY_SESSION_NAME"] = path
	return env
}
