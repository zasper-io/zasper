package session

import (
	"fmt"
	"log"
	"path/filepath"
	"time"
	"zasper_go/content"
	"zasper_go/core"
	"zasper_go/kernel"
	"zasper_go/models"

	"github.com/google/uuid"
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
	if ok {
		//do something here
		log.Println("session exists")
	} else {
		kernelId := startKernelForSession(req.Path, req.Name)

		log.Println(kernelId)
		// pendingSessions.update()
		session = models.SessionModel{
			Id:          session_id,
			Name:        req.Name,
			SessionType: req.SessionType,
			Path:        req.Path,
			Kernel: models.KernelModel{
				Id:             kernelId,
				Name:           req.Name,
				LastActivity:   time.Now().UTC().String(),
				ExecutionState: "",
				Connections:    0,
			},
		}
		core.ZasperSession[session_id] = session
	}

	return session
}

func startKernelForSession(path string, name string) string {
	/*
		Starts a Jupyter Kernel for a new Sesion
	*/
	kernel_path := content.GetKernelPath(path)
	fmt.Println(kernel_path)
	env := getKernelEnv(path, name)
	log.Println("starting kernel")
	kernelId := kernel.MappingKMStartKernel(path, name, env)
	return kernelId
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
