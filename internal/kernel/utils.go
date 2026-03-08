package kernel

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	mrand "math/rand/v2"
	"net"
	"os"
	"runtime"
	"sync"

	"github.com/rs/zerolog/log"
)

func GetUsername() string {
	// Check if the OS is Windows
	if runtime.GOOS == "windows" {
		return os.Getenv("USERNAME") // Windows typically uses "USERNAME"
	}
	// For UNIX-like systems (Linux, macOS), use "USER"
	return os.Getenv("USER")
}
func newID() string {
	// newID generates a new random ID as a string.
	// The ID format is 32 random bytes as hex-encoded text, with chunks separated by '-'.
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		log.Error().Msgf("Failed to generate random bytes: %v", err)
	}

	hexStr := hex.EncodeToString(buf)

	//format: xxxx-xxxx-xxxx-xxxx
	return fmt.Sprintf("%s-%s-%s-%s-%s", hexStr[:8], hexStr[8:12], hexStr[12:16], hexStr[16:20], hexStr[20:32])
}

func newIDBytes() []byte {
	// newIDBytes returns newID as ASCII bytes.
	id := newID()
	return []byte(id)
}

/*********************************************************************
**********************************************************************
***                           PORT CACHING                         ***
**********************************************************************
*********************************************************************/

var (
	currentlyUsedPorts []int
	portMutex          sync.Mutex
)

func isPortAvailable(port int) bool {
	// Test localhost binding (what Python ZeroMQ uses)
	localListener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		log.Debug().Msgf("Port %d: localhost binding failed - %v", port, err)
		return false
	}
	defer localListener.Close()

	// Test all-interfaces binding (for completeness)
	allListener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		log.Debug().Msgf("Port %d: all-interfaces binding failed - %v", port, err)
		return false
	}
	defer allListener.Close()

	log.Debug().Msgf("Port %d: available on both 127.0.0.1 and 0.0.0.0", port)
	return true
}

func findAvailablePort() (int, error) {
	portMutex.Lock()
	defer portMutex.Unlock()

	maxAttempts := 100
	for attempt := 0; attempt < maxAttempts; attempt++ {
		port := mrand.IntN(1000) + 5000

		// Skip if we've already allocated this port
		if portExists(port) {
			log.Debug().Msgf("Port %d: already in our tracking list", port)
			continue
		}

		// Check if port is available on both interfaces
		if !isPortAvailable(port) {
			continue
		}

		// Port is free - claim it
		currentlyUsedPorts = append(currentlyUsedPorts, port)
		log.Debug().Msgf("Successfully allocated port %d", port)
		return port, nil
	}

	return 0, fmt.Errorf("could not find available port after %d attempts", maxAttempts)
}

func portExists(portNum int) bool {
	for _, port := range currentlyUsedPorts {
		if port == portNum {
			return true
		}
	}
	return false
}

func releasePort(port int) {
	portMutex.Lock()
	defer portMutex.Unlock()

	for i, p := range currentlyUsedPorts {
		if p == port {
			currentlyUsedPorts = append(currentlyUsedPorts[:i], currentlyUsedPorts[i+1:]...)
			log.Debug().Msgf("Released port %d", port)
			return
		}
	}
}
