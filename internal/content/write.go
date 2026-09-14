package content

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/zasper-io/zasper/internal/atomicfile"
	"github.com/zasper-io/zasper/internal/nbformat"

	"github.com/rs/zerolog/log"
)

func UpdateNbContent(path, ftype, format string, content interface{}) error {
	osPath, err := savePath(path)
	if err != nil {
		return err
	}

	// Convert content to JSON if it's a string or []byte, otherwise directly marshal it
	var contentBytes []byte

	switch v := content.(type) {
	case string:
		// If content is a string, assume it's JSON and convert it to []byte
		contentBytes = []byte(v)
	case []byte:
		// If content is already []byte, assume it's JSON
		contentBytes = v
	case map[string]interface{}:
		// If content is already a map, we can directly marshal it into the notebook
		contentBytes, err = json.Marshal(content)
		if err != nil {
			return fmt.Errorf("failed to marshal map content into JSON: %w", err)
		}
	default:
		// If the content is an unsupported type
		return fmt.Errorf("content is not a valid type (expected string, []byte, or map[string]interface{}), got: %T", content)
	}

	// The editor sends the notebook back in the form it received it, so no line joining here.
	nb, err := nbformat.Unmarshal(contentBytes)
	if err != nil {
		return fmt.Errorf("failed to unmarshal content into notebook: %w", err)
	}

	// Checked as it will be written, not as the editor sent it: Normalize takes back out what the
	// editor added, so what is left is a problem in the document itself. Reported and not refused,
	// because a save is the wrong moment to decline to keep someone's work.
	disk := nbformat.Normalize(nb)
	for _, problem := range nbformat.Validate(disk) {
		log.Warn().Msgf("saving %s with something the notebook format does not allow: %s", path, problem)
	}

	nbJSON, err := nbformat.Marshal(disk)
	if err != nil {
		return fmt.Errorf("failed to marshal notebook: %w", err)
	}

	// Atomically: a notebook half-written by a crash is a notebook lost, and this is the save path.
	if _, err := atomicfile.Write(osPath, bytes.NewReader(nbJSON), 0o644); err != nil {
		log.Error().Err(err).Msgf("Error updating notebook content for path: %s", osPath)
		return fmt.Errorf("error writing notebook to path %s: %w", path, err)
	}

	log.Debug().Msgf("saved notebook %s", path)
	return nil
}

// UpdateContent writes a file from text, or from base64 for bytes that are not text.
func UpdateContent(path, ftype, format, content string) error {
	osPath, err := savePath(path)
	if err != nil {
		return err
	}

	data := []byte(content)
	switch format {
	case "", "text":
	case "base64":
		if data, err = base64.StdEncoding.DecodeString(content); err != nil {
			return fmt.Errorf("the content is not valid base64: %w", err)
		}
	default:
		return fmt.Errorf("cannot save a file in format %q", format)
	}

	if _, err := atomicfile.Write(osPath, bytes.NewReader(data), 0o644); err != nil {
		log.Error().Err(err).Msgf("Error updating content for path: %s", osPath)
		return err
	}
	return nil
}
