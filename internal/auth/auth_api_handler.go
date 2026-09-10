package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/core"
)

var (
	jwtSecret     []byte
	jwtSecretOnce sync.Once
)

/*
SetUpJWTSecret settles the signing key for this process, once.

It used to be an init(), which meant it ran — and logged — before main() had configured the logger,
so its line came out in a different format from every line after it. Server startup calls this
instead, in an order it controls.
*/
func SetUpJWTSecret() {
	jwtSecretOnce.Do(func() {
		if secret := os.Getenv("ZASPER_JWT_SECRET"); secret != "" {
			jwtSecret = []byte(secret)
			log.Info().Msg("JWT secret loaded from environment")
			return
		}

		generated, err := generateRandomSecret(32)
		if err != nil {
			log.Fatal().Err(err).Msg("Failed to generate JWT secret")
		}
		jwtSecret = generated
		log.Warn().Msg("ZASPER_JWT_SECRET not set — using an ephemeral random secret (tokens will not survive a restart)")
	})
}

func generateRandomSecret(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}

// contextKey is this package's own key type, so that a value stored here cannot be read or shadowed
// by another package storing something under the same name.
type contextKey string

const userIDKey contextKey = "user_id"

// UserID answers the authenticated user a request carries, and whether it carries one at all.
func UserID(ctx context.Context) (string, bool) {
	userID, ok := ctx.Value(userIDKey).(string)
	return userID, ok
}

// bearerToken pulls the JWT out of an Authorization header, "" when there is none. The scheme is
// matched case-insensitively, as RFC 7235 requires.
func bearerToken(r *http.Request) string {
	const scheme = "bearer "

	header := r.Header.Get("Authorization")
	if len(header) <= len(scheme) || !strings.EqualFold(header[:len(scheme)], scheme) {
		return ""
	}
	return header[len(scheme):]
}

/*
websocketToken is bearerToken for a websocket route, falling back to a `token` query parameter.

A browser cannot authenticate one any other way: `new WebSocket(url)` takes a URL and nothing else, so
there is no header to put a token in. It is why /api/contents/watch answered 401 to the file browser
for as long as protected mode existed. Jupyter passes its token the same way, for the same reason.

A token in a URL is a token in the access log, which is why only the routes with no alternative read
one from there.
*/
func websocketToken(r *http.Request) string {
	if token := bearerToken(r); token != "" {
		return token
	}
	return r.URL.Query().Get("token")
}

// userFromToken validates a JWT and answers the user id it carries.
func userFromToken(tokenStr string) (string, error) {
	if tokenStr == "" {
		return "", fmt.Errorf("missing credentials")
	}

	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		// Make sure the signing method is HMAC
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return "", fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", fmt.Errorf("invalid token claims")
	}

	// Comma-ok rather than a bare assertion: a token carrying user_id as a JSON number is still a
	// correctly signed token, and asserting on it would panic the handler.
	userID, ok := claims["user_id"].(string)
	if !ok || userID == "" {
		return "", fmt.Errorf("invalid token claims")
	}
	return userID, nil
}

// authenticate gates a route on the token that readToken finds in the request.
func authenticate(next http.Handler, readToken func(*http.Request) string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, err := userFromToken(readToken(r))
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// JwtAuthMiddleware gates a REST route on the Authorization header.
func JwtAuthMiddleware(next http.Handler) http.Handler {
	return authenticate(next, bearerToken)
}

// JwtWebsocketMiddleware gates a websocket route, which authenticates by query parameter; see
// websocketToken for why it cannot use the header.
func JwtWebsocketMiddleware(next http.Handler) http.Handler {
	return authenticate(next, websocketToken)
}

type LoginResponse struct {
	Token        string `json:"token"`
	RedirectPath string `json:"redirect_path"`
}

type User struct {
	ID       string `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"` // e.g., "admin", "editor", "viewer"
}

func GetUserByUsername(username string) (User, error) {
	return User{
		ID:       "1",
		Username: core.Zasper.UserName,
		Role:     "user",
	}, nil
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	var creds struct {
		AccessToken string `json:"accessToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Constant time, so that the answer does not say how much of the token was right.
	if subtle.ConstantTimeCompare([]byte(creds.AccessToken), []byte(core.ServerAccessToken)) != 1 {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	user, err := GetUserByUsername(creds.AccessToken)
	if err != nil {
		http.Error(w, "User not found", http.StatusUnauthorized)
		return
	}

	// Create JWT
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"role":    user.Role,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})

	log.Debug().Msgf("Login role: %v", user.Role)

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		http.Error(w, "Could not generate token", http.StatusInternalServerError)
		return
	}
	redirectPath := "/"
	if user.Role == "admin" {
		redirectPath = "/"
	}

	resp := LoginResponse{
		Token:        tokenString,
		RedirectPath: redirectPath,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
