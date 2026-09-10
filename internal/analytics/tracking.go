package analytics

import (
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/posthog/posthog-go"
	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/core"
)

const phEndPoint = "https://us.i.posthog.com"
const phAPIKey = "phc_ptZIEQ1RgjxThkHTSeuxSgx7lxHSvnQx8anw9bD7A6R"

// Lets the acceptance test point ingestion at a local recorder and read back exactly what would have
// been sent. Not a user-facing setting.
const endpointEnvVar = "ZASPER_POSTHOG_ENDPOINT"

var (
	mu         sync.RWMutex
	client     posthog.Client
	trackingID string
	startedAt  time.Time
	enabled    bool
	// Set when --tracking=false or ZASPER_TELEMETRY=0 said so. Those are per-run and outrank the
	// config file, so the settings toggle must not be able to undo one for the running process.
	forcedOff   bool
	trackingIDs = 21 // characters; a truncated UUID, kept for continuity with existing installs
)

// Enabled reports whether anything at all will be sent. Every hook checks this first, so that turning
// tracking off means no work and no network rather than a dropped payload.
func Enabled() bool {
	mu.RLock()
	defer mu.RUnlock()
	return enabled && client != nil
}

// DisableForSession records that this run was started with tracking off. Nothing can turn it back on
// until the process restarts.
func DisableForSession() {
	mu.Lock()
	forcedOff = true
	enabled = false
	mu.Unlock()
}

// SetEnabled applies the settings-panel toggle. Turning it on connects the client if this is the
// first time in this run; turning it off stops the sending without tearing the client down, so it can
// be turned back on without another handshake.
func SetEnabled(on bool) {
	mu.RLock()
	blocked, connected := forcedOff, client != nil
	mu.RUnlock()

	if blocked {
		return
	}

	if on && !connected {
		SetUpPostHogClient()
		return
	}

	mu.Lock()
	enabled = on
	mu.Unlock()
}

// GetAnonymousTrackingId returns the random per-install id, generating and persisting one on first
// use. It identifies an installation, never a person: nothing else about the machine goes into it.
func GetAnonymousTrackingId() (string, error) {
	config, err := core.ReadConfig()
	if err != nil {
		log.Debug().Msgf("Error reading config file: %v", err)
		return "", err
	}

	if len(config.TrackingID) != trackingIDs {
		config.TrackingID = newTrackingID()
		if err := core.WriteConfig(config); err != nil {
			return "", err
		}
	}

	return config.TrackingID, nil
}

// ResetTrackingId throws the current id away and starts a new one, so a user can break the link
// between what they have already sent and what they send next.
func ResetTrackingId() error {
	config, err := core.ReadConfig()
	if err != nil {
		return err
	}
	config.TrackingID = newTrackingID()
	if err := core.WriteConfig(config); err != nil {
		return err
	}

	mu.Lock()
	trackingID = config.TrackingID
	mu.Unlock()
	return nil
}

func newTrackingID() string {
	return strings.ReplaceAll(uuid.New().String(), "-", "")[:trackingIDs]
}

// SetUpPostHogClient connects the client and fixes the properties that ride on every event. It is
// only called when tracking is on; nothing else in this package works until it has run.
func SetUpPostHogClient() error {
	mu.RLock()
	blocked := forcedOff
	mu.RUnlock()
	if blocked {
		return nil
	}

	if phAPIKey == "" {
		log.Error().Msg("POSTHOG_API_KEY is not set")
		return nil
	}

	endpoint := phEndPoint
	if override := os.Getenv(endpointEnvVar); override != "" {
		endpoint = override
	}

	// Everything privacy-relevant is decided once, here, rather than at each call site.
	//
	//	$ip            empty tells PostHog to discard the source address instead of storing it or
	//	               looking it up. It is the one identifier the transport hands over for free.
	//	$geoip_disable the SDK already defaults this on for server-side use; set it so an SDK
	//	               upgrade cannot quietly turn it off.
	//	$process_person_profile
	//	               events only. Without it PostHog builds a person record per distinct id and
	//	               starts accumulating properties against it.
	defaults := posthog.NewProperties().
		Set("$ip", "").
		Set("$geoip_disable", true).
		Set("$process_person_profile", false).
		Set("zasper_version", strings.TrimSpace(core.Zasper.Version)).
		Set("os", core.Zasper.OSName).
		Set("arch", runtime.GOARCH).
		Set("source", "web")

	newClient, err := posthog.NewWithConfig(phAPIKey, posthog.Config{
		Endpoint:               endpoint,
		DisableGeoIP:           posthog.Ptr(true),
		DefaultEventProperties: defaults,
	})
	if err != nil {
		log.Error().Msgf("Error setting up PostHog client: %v", err)
		return err
	}

	id, err := GetAnonymousTrackingId()
	if err != nil {
		log.Error().Msgf("Error getting tracking ID: %v", err)
	}

	mu.Lock()
	client = newClient
	trackingID = id
	startedAt = time.Now()
	enabled = true
	mu.Unlock()

	return nil
}

// Track sends one event, if and only if the catalogue in events.go permits every part of it. A
// rejected event is logged and dropped whole — never trimmed and sent, which would hide the bug that
// produced it while still putting something on the wire.
func Track(event EventType, props map[string]interface{}) {
	if !Enabled() {
		return
	}

	if props == nil {
		props = map[string]interface{}{}
	}
	if err := Validate(event, props); err != nil {
		log.Warn().Msgf("Dropping telemetry event: %v", err)
		return
	}

	properties := posthog.NewProperties()
	for key, value := range props {
		properties.Set(key, value)
	}

	mu.RLock()
	id, current := trackingID, client
	mu.RUnlock()

	if err := current.Enqueue(posthog.Capture{
		DistinctId: id,
		Event:      string(event),
		Properties: properties,
	}); err != nil {
		log.Error().Msgf("Failed to send tracking event: %v", err)
		return
	}

	log.Debug().Msgf("Queued telemetry event %s", event)
}

// TrackServerStart records the start of a session.
func TrackServerStart() {
	Track(EventServerStarted, nil)
}

// CloseClient reports how long the session lasted and blocks until the queue has drained.
func CloseClient() {
	if !Enabled() {
		return
	}

	mu.RLock()
	uptime := time.Since(startedAt)
	current := client
	mu.RUnlock()

	Track(EventServerShutdown, map[string]interface{}{
		"uptime_bucket": Bucket(int(uptime.Minutes())),
	})

	mu.Lock()
	enabled = false
	client = nil
	mu.Unlock()

	current.Close()
}
