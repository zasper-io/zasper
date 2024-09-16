package kernel

import "os"

func getUsername() string {
	// note that this may be USER on some UNIX platforms
	return os.Getenv("USERNAME")
}
