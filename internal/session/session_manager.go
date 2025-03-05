package session

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/models"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

func ListSessions() map[string]models.SessionModel {
	return core.ZasperSession
}

func CreateSession(req models.SessionModel) models.SessionModel {
	/*
		Creates a new Sesion
	*/
	session_id := uuid.New().String()
	var session models.SessionModel
	session, ok := core.ZasperSession[req.Id]
	log.Info().Msgf("creating session %s", req.Kernel.Name)
	if ok {
		//do something here
		log.Info().Msg("session exists")
	} else {
		kernelId := startKernelForSession(req.Path, req.Kernel.Name)
		log.Info().Msgf("started kernel with id %s", kernelId)
		// pendingSessions.update()
		session = models.SessionModel{
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
		core.ZasperSession[session_id] = session
	}

	return session
}

func DeleteSession(req models.SessionModel) {
	/*
		Deletes a Sesion
	*/
	log.Info().Msgf("deleting session %s", req.Id)
	session, ok := core.ZasperSession[req.Id]
	if !ok {
		log.Info().Msg("session does not exist")
		return
	}
	// stop kernel
	stopKernelForSession(session.Kernel.Id)
	// delete session

	delete(core.ZasperSession, req.Id)
	return
}

func startKernelForSession(path string, name string) string {
	/*
		Starts a Jupyter Kernel for a new Sesion
	*/
	kernel_path := content.GetKernelPath(path)
	fmt.Println(kernel_path)
	env := getKernelEnv(path, name)
	log.Info().Msg("starting kernel")
	kernelId := kernel.StartKernelManager(path, name, env)
	return kernelId
}

func stopKernelForSession(kernelId string) {
	/*
		Stops a Jupyter Kernel for a Sesion
	*/
	kernel.StopKernelManager(kernelId)
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
