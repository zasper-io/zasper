package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/httpx"
)

const (
	// sessionCookie carries a browser's session. HttpOnly, so a script running in the page — a
	// notebook output that got past the sanitiser — cannot read it and take it elsewhere.
	sessionCookie   = "zasper_session"
	sessionLifetime = 24 * time.Hour
)

// sessionUserID is the one user a Zasper server has: whoever holds its access token.
const sessionUserID = "1"

// Auth is the gate in front of the API: it trades the access token for sessions and checks them.
type Auth struct {
	accessToken string
	// Sessions are signed with a key derived from the access token, so there is no second secret to
	// configure: a pinned ZASPER_ACCESS_TOKEN keeps sessions valid across a restart, and a new token
	// signs everyone out.
	key     []byte
	revoked *revokedSessions
	logins  *loginLimiter
}

// New builds the gate for a server whose access token is accessToken.
func New(accessToken string) *Auth {
	// The label keeps this key distinct from any other use the same token is ever put to.
	key := sha256.Sum256([]byte("zasper/session-key\x00" + accessToken))
	return &Auth{
		accessToken: accessToken,
		key:         key[:],
		revoked:     newRevokedSessions(),
		logins:      newLoginLimiter(),
	}
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
sessionToken finds the session a request carries: the Authorization header, which scripts and API
clients send, or the session cookie, which a browser sends on every request and websocket upgrade.
A token in the query string is not read, since it would end up in history and proxy logs.
*/
func sessionToken(r *http.Request) (token string, fromCookie bool) {
	if token := bearerToken(r); token != "" {
		return token, false
	}
	if cookie, err := r.Cookie(sessionCookie); err == nil && cookie.Value != "" {
		return cookie.Value, true
	}
	return "", false
}

type session struct {
	userID  string
	id      string
	expires time.Time
}

// invalidTokenError keeps the 401's message to "invalid token" while letting a caller ask jwt why.
type invalidTokenError struct{ cause error }

func (e invalidTokenError) Error() string { return "invalid token" }
func (e invalidTokenError) Unwrap() error { return e.cause }

var errSignedOut = errors.New("this session has been signed out")

// parseSession validates a JWT this server issued and answers the session it names.
func (a *Auth) parseSession(tokenStr string) (session, error) {
	if tokenStr == "" {
		return session{}, fmt.Errorf("missing credentials")
	}

	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return a.key, nil
	})
	if err != nil || !token.Valid {
		return session{}, invalidTokenError{err}
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return session{}, fmt.Errorf("invalid token claims")
	}

	// Comma-ok: a correctly signed token carrying user_id as a number would otherwise panic the handler.
	userID, ok := claims["user_id"].(string)
	if !ok || userID == "" {
		return session{}, fmt.Errorf("invalid token claims")
	}
	// Without an id and an expiry a token could not be signed out, so it is not accepted.
	id, ok := claims["jti"].(string)
	if !ok || id == "" {
		return session{}, fmt.Errorf("invalid token claims")
	}
	expires, err := claims.GetExpirationTime()
	if err != nil || expires == nil {
		return session{}, fmt.Errorf("invalid token claims")
	}

	if a.revoked.has(id) {
		return session{}, errSignedOut
	}
	return session{userID: userID, id: id, expires: expires.Time}, nil
}

// userFromToken validates a JWT and answers the user id it carries.
func (a *Auth) userFromToken(tokenStr string) (string, error) {
	s, err := a.parseSession(tokenStr)
	return s.userID, err
}

/*
crossSiteWrite reports whether a request changes something and came from a page other than Zasper's.

SameSite=Strict stops another site from sending the cookie, but not another app on this machine, which
is the same site on another port. Reads are left alone, because another origin cannot see what they
answer.
*/
func crossSiteWrite(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return !httpx.SameOrigin(r)
}

func (a *Auth) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, fromCookie := sessionToken(r)
		s, err := a.parseSession(token)
		if err != nil {
			httpx.SendErrorResponse(w, http.StatusUnauthorized, err.Error())
			return
		}
		if fromCookie && crossSiteWrite(r) {
			httpx.SendErrorResponse(w, http.StatusForbidden, "this request did not come from Zasper's own page")
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, s.userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Middleware gates a REST route.
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return a.authenticate(next)
}

// WebsocketMiddleware gates a websocket route. The upgrade is a GET, and the websocket handlers check
// its Origin themselves.
func (a *Auth) WebsocketMiddleware(next http.Handler) http.Handler {
	return a.authenticate(next)
}

type LoginResponse struct {
	Token        string `json:"token"`
	RedirectPath string `json:"redirect_path"`
}

func sessionCookieFor(r *http.Request, value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookie,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   r.TLS != nil,
	}
}

// clientAddress is who a sign-in attempt is counted against. Behind a reverse proxy every client is
// the proxy, so they share one allowance.
func clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// Login trades the access token for a session: set as a cookie for the browser, and also in the answer
// for a script, which sends it back as a bearer token.
func (a *Auth) Login(w http.ResponseWriter, r *http.Request) {
	client := clientAddress(r)
	if wait := a.logins.blocked(client, time.Now()); wait > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
		httpx.SendErrorResponse(w, http.StatusTooManyRequests, "Too many failed sign-ins; try again in a minute")
		return
	}

	var creds struct {
		AccessToken string `json:"accessToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid request")
		return
	}

	// Constant time, so that the answer does not say how much of the token was right.
	if subtle.ConstantTimeCompare([]byte(creds.AccessToken), []byte(a.accessToken)) != 1 {
		a.logins.failed(client, time.Now())
		httpx.SendErrorResponse(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}
	a.logins.succeeded(client)

	id, err := core.GenerateRandomToken(16)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, "Could not generate token")
		return
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": sessionUserID,
		"jti":     id,
		"exp":     time.Now().Add(sessionLifetime).Unix(),
	})
	tokenString, err := token.SignedString(a.key)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, "Could not generate token")
		return
	}

	http.SetCookie(w, sessionCookieFor(r, tokenString, int(sessionLifetime.Seconds())))
	httpx.SendJSON(w, http.StatusOK, LoginResponse{Token: tokenString, RedirectPath: "/"})
}

/*
Logout signs a session out. It is revoked on the server, so a copy of the token held anywhere else stops
working too, and the browser is told to drop the cookie. A request without a valid session still has its
cookie cleared and answers 204: there is nothing left to sign out.
*/
func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	token, fromCookie := sessionToken(r)
	if fromCookie && crossSiteWrite(r) {
		httpx.SendErrorResponse(w, http.StatusForbidden, "this request did not come from Zasper's own page")
		return
	}
	if s, err := a.parseSession(token); err == nil {
		a.revoked.add(s.id, s.expires)
	}

	http.SetCookie(w, sessionCookieFor(r, "", -1))
	w.WriteHeader(http.StatusNoContent)
}
