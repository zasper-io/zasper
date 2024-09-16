package core

import "zasper_go/models"

var ZasperSession map[string]models.SessionModel

func SetUpActiveSessions() map[string]models.SessionModel {
	return make(map[string]models.SessionModel)
}
