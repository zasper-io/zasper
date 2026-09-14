package session

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/models"
)

// Create starts a session on a new kernel, or answers with the one the file is already running on: see
// runningSessionFor.
func (s *Sessions) Create(req models.SessionModel) (models.SessionModel, error) {
	log.Debug().Msgf("creating session %s", req.Kernel.Name)

	// Two requests for the same notebook at once would otherwise both find nothing running and both
	// start a kernel.
	defer s.lockPath(req.Path)()

	// Counted here because this is the one place both answers are visible: how often opening a notebook
	// gets a fresh kernel versus rejoining one that is already running.
	language := analytics.NormalizeLanguage(req.Kernel.Name)

	if session, ok := s.runningSessionFor(req); ok {
		log.Debug().Msgf("session %s is already running %s", session.Id, session.Path)
		analytics.Track(analytics.EventKernelStarted, map[string]interface{}{
			"kernel_language": language,
			"reused":          true,
		})
		return session, nil
	}

	kernelId, err := s.startKernel(req.Path, req.Kernel.Name)
	if err != nil {
		analytics.Track(analytics.EventKernelStartFailed, map[string]interface{}{
			"kernel_language": language,
		})
		return models.SessionModel{}, err
	}
	analytics.Track(analytics.EventKernelStarted, map[string]interface{}{
		"kernel_language": language,
		"reused":          false,
	})
	log.Debug().Msgf("started kernel with id %s", kernelId)

	sessionId := uuid.New().String()
	session := models.SessionModel{
		Id:          sessionId,
		Name:        req.Name,
		SessionType: req.SessionType,
		Path:        req.Path,
		// A snapshot, taken when the session was made: what a kernel is doing now is /api/kernels' answer,
		// and this is here because Jupyter's session model carries it. RFC 3339, which `new Date` reads.
		Kernel: models.KernelModel{
			Id:             kernelId,
			Name:           req.Kernel.Name,
			LastActivity:   time.Now().UTC().Format(time.RFC3339),
			ExecutionState: "",
			Connections:    0,
		},
	}
	s.set(sessionId, session)

	return session, nil
}

// lockPath waits for its turn on path and answers the function that gives the turn up. A path's lock is
// dropped once nobody is holding or waiting for it.
func (s *Sessions) lockPath(path string) func() {
	locks := &s.pathLocks
	locks.mu.Lock()
	lock := locks.held[path]
	if lock == nil {
		lock = &pathLock{}
		locks.held[path] = lock
	}
	lock.users++
	locks.mu.Unlock()

	lock.Lock()
	return func() {
		lock.Unlock()

		locks.mu.Lock()
		lock.users--
		if lock.users == 0 {
			delete(locks.held, path)
		}
		locks.mu.Unlock()
	}
}

/*
runningSessionFor finds the session a request is asking to join rather than to start: the one it names
by id, or the one already running the same file on the same kernel.

Joining is Jupyter's own answer to a second request for a notebook that is running, and what lets a
reloaded page pick up where it was: the kernel still holds the state the notebook was built on, including
the widgets in its outputs.
*/
func (s *Sessions) runningSessionFor(req models.SessionModel) (models.SessionModel, bool) {
	if session, ok := s.Get(req.Id); ok {
		return session, true
	}

	session, ok := s.forPath(req.Path, req.Kernel.Name)
	if !ok {
		return models.SessionModel{}, false
	}
	if _, alive := s.kernels.Get(session.Kernel.Id); !alive {
		// The session outlived its kernel. Nothing can be run on it, so it goes rather than shadowing the
		// session about to replace it.
		log.Info().Msgf("session %s outlived its kernel; dropping it", session.Id)
		s.remove(session.Id)
		return models.SessionModel{}, false
	}
	return session, true
}

// Delete ends a session and stops its kernel.
func (s *Sessions) Delete(sessionId string) error {
	log.Debug().Msgf("deleting session %s", sessionId)
	// Taken out first, and the kernel stopped only by whoever took it out: two requests deleting the same
	// session would otherwise both stop the kernel, and both be told it worked.
	session, ok := s.remove(sessionId)
	if !ok {
		return fmt.Errorf("session %s does not exist", sessionId)
	}
	if err := s.kernels.Stop(session.Kernel.Id); err != nil {
		// The session is torn down regardless: its kernel is already gone.
		log.Error().Msgf("Error stopping kernel %s: %v", session.Kernel.Id, err)
	}
	return nil
}

/*
Relocate follows a renamed or moved file through the sessions, so the session list stops naming a path
that no longer exists and a lookup by path still finds the kernel. A running kernel's own working
directory cannot be changed, so this is the record catching up; oldPath may be a folder, in which case
every session under it follows.
*/
func (s *Sessions) Relocate(oldPath, newPath string) int {
	relocated := s.update(func(session models.SessionModel) (models.SessionModel, bool) {
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
		log.Debug().Msgf("moved %d session(s) from %s to %s", relocated, oldPath, newPath)
	}
	return relocated
}

// relocate rewrites a path that is oldPath or sits under it, by segments rather than by prefix so that
// `notes2.txt` does not follow `notes.txt`.
func relocate(path, oldPath, newPath string) (string, bool) {
	if path == oldPath {
		return newPath, true
	}
	if prefix := oldPath + "/"; strings.HasPrefix(path, prefix) {
		return newPath + "/" + strings.TrimPrefix(path, prefix), true
	}
	return "", false
}

func (s *Sessions) startKernel(path string, name string) (string, error) {
	dir, env := s.kernelPlacement(path)
	log.Debug().Msgf("starting kernel %s in %s", name, dir)
	return s.kernels.Start(dir, name, env)
}

/*
kernelPlacement answers the folder a notebook's kernel starts in, and the environment it is given.

The folder is the notebook's own, so that a relative path in a cell means what it means beside the file.
A path that names no folder inside the project gets the project root. JPY_SESSION_NAME is the notebook's
absolute path, which is how code running in a kernel can find the file it belongs to.
*/
func (s *Sessions) kernelPlacement(path string) (string, map[string]string) {
	root := s.project.Root()
	notebook := s.project.SafePath(path)
	if notebook == "" || notebook == root {
		return root, map[string]string{}
	}

	env := map[string]string{"JPY_SESSION_NAME": notebook}
	dir := filepath.Dir(notebook)
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return root, env
	}
	return dir, env
}
