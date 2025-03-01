package analytics

import (
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/posthog/posthog-go"
	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/core"
)

const phEndPoint = "https://us.i.posthog.com"

var client posthog.Client
var trackingID string
var apiKey string

// Function to generate or retrieve the tracking ID from the config
func GetAnonymousTrackingId() (string, error) {
	config, err := core.ReadConfig()
	if err != nil {
		log.Info().Msgf("Error reading config file: %v", err)
		return "", err
	}

	if len(config.TrackingID) != 21 {
		// Generate a new UUID and trim it to 21 characters
		config.TrackingID = uuid.New().String()
		config.TrackingID = strings.ReplaceAll(config.TrackingID, "-", "")[:21]

		err = core.WriteConfig(config)
		if err != nil {
			return "", err
		}
	}

	return config.TrackingID, nil
}

func SetUpPostHogClient() error {
	apiKey = os.Getenv("POSTHOG_API_KEY")
	if apiKey == "" {
		log.Error().Msg("POSTHOG_API_KEY is not set")
		return nil
	}

	var err error
	client, err = posthog.NewWithConfig(
		apiKey,
		posthog.Config{Endpoint: phEndPoint})
	if err != nil {
		log.Error().Msgf("Error setting up PostHog client: %v", err)
		return err
	}
	trackingID, err = GetAnonymousTrackingId()
	if err != nil {
		log.Error().Msgf("Error getting tracking ID: %v", err)
	}
	return nil
}

func TrackEvent(eventName string, properties map[string]interface{}) {
	if apiKey == "" {
		log.Warn().Msg("API key is missing. Event tracking skipped.")
		return
	}

	properties["source"] = "web"

	err := client.Enqueue(posthog.Capture{
		DistinctId: trackingID,
		Event:      eventName,
		Properties: properties,
	})

	if err != nil {
		log.Error().Msgf("Failed to send tracking event: %v", err)
		return
	}

	log.Info().Msg("Sent tracking event successfully.")
}
