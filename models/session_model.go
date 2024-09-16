package models

type SessionModel struct {
	Id          string      `json:"id"`
	Path        string      `json:"path"`
	Name        string      `json:"name"`
	SessionType string      `json:"type"`
	Kernel      KernelModel `json:"kernel"`
}
