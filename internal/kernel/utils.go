package kernel

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
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

// findAvailablePort asks the kernel for a free port on the loopback interface, the same way
// jupyter_client does: bind to port 0, read what was assigned, and let go of it. The kernel process
// binds it a moment later, so the port is only reserved by convention — the tracking list is what
// stops two kernels being handed the same one before either has bound it.
func findAvailablePort() (int, error) {
	portMutex.Lock()
	defer portMutex.Unlock()

	// A handful of attempts, only to step over a port already handed out and not yet bound. There is
	// nothing to retry when the OS is out of ports.
	const maxAttempts = 10
	for attempt := 0; attempt < maxAttempts; attempt++ {
		// 127.0.0.1 and not every interface: that is where the kernel binds (see createKernelManager),
		// and asking about the wildcard address answers a question nobody asked.
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return 0, fmt.Errorf("could not open a port to be assigned one: %w", err)
		}
		port := listener.Addr().(*net.TCPAddr).Port
		if err := listener.Close(); err != nil {
			return 0, fmt.Errorf("could not release port %d after being assigned it: %w", port, err)
		}

		if portExists(port) {
			log.Debug().Msgf("Port %d: already in our tracking list", port)
			continue
		}

		currentlyUsedPorts = append(currentlyUsedPorts, port)
		log.Debug().Msgf("Successfully allocated port %d", port)
		return port, nil
	}

	return 0, fmt.Errorf("could not find an unclaimed port after %d attempts", maxAttempts)
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
