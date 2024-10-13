package kernel

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"

	"github.com/rs/zerolog/log"
)

func getUsername() string {
	// note that this may be USER on some UNIX platforms
	// return os.Getenv("USERNAME")
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
