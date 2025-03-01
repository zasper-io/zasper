package kernel

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	mrand "math/rand/v2"
	"net"
	"os"
	"runtime"
	"strconv"

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
		log.Fatal().Msgf("Failed to generate random bytes: %v", err)
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

var currentlyUsedPorts []int

func findAvailablePort() (int, error) {

	// Start with a random port number or a specific range if needed.
	for {
		port := mrand.IntN(1000) + 5000
		if portExists(port) {
			continue
		}
		log.Debug().Msgf("check port %d", port)
		l, err := net.Listen("tcp", ":"+strconv.Itoa(port))
		if err == nil {
			currentlyUsedPorts = append(currentlyUsedPorts, port)
			l.Close()
			return port, nil
		}
	}
}

func portExists(portNum int) bool {
	// Iterate over the list of ports
	for _, port := range currentlyUsedPorts {
		// Only add the port to the result if it is not the one to remove
		if port == portNum {
			return true
		}
	}
	return false
}

func removePort(portToRemove int) {
	// Create a new slice to hold the ports after removal
	var result []int

	// Iterate over the list of ports
	for _, port := range currentlyUsedPorts {
		// Only add the port to the result if it is not the one to remove
		if port != portToRemove {
			result = append(result, port)
		}
	}

	currentlyUsedPorts = result
}
