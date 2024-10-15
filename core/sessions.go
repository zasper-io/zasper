package core

import "github.com/zasper-io/zasper/models"

var ZasperSession map[string]models.SessionModel

func SetUpActiveSessions() map[string]models.SessionModel {
	return make(map[string]models.SessionModel)
}
