package models

type KernelModel struct {
	Id             string `json:"id"`
	Name           string `json:"name"`
	LastActivity   string `json:"last_activity"`
	ExecutionState string `json:"execution_state"`
	Connections    int    `json:"connections"`
	// Zasper's own: what the kernel said about itself in its kernel_info_reply, nil until it has.
	Info *KernelInfo `json:"info,omitempty"`
}

// KernelInfo is the part of a kernel_info_reply that says what the kernel is, as opposed to what it is doing.
type KernelInfo struct {
	ProtocolVersion       string                 `json:"protocol_version"`
	Implementation        string                 `json:"implementation"`
	ImplementationVersion string                 `json:"implementation_version"`
	LanguageInfo          map[string]interface{} `json:"language_info"`
}
