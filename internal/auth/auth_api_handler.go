package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/zasper-io/zasper/internal/core"
	zhttp "github.com/zasper-io/zasper/internal/http"
)

/*
sessionKey is the key browser sessions are signed with, derived from the server access token.

There is no separate secret to configure: the access token already grants a session — anyone holding
it can ask /auth/login for one — so signing with a key derived from it gives away nothing further. It
also makes the lifetime of a session follow the thing it was traded for. A token that is random per
start signs everyone out on restart; pinning ZASPER_ACCESS_TOKEN keeps sessions valid across one, and
changing that token invalidates every session minted under the old one.

Derived per call rather than settled once, so that nothing has to run in a particular order at
startup and a token changed in a test is honoured immediately.
*/
func sessionKey() []byte {
	// The label keeps this key distinct from any other use the same token is ever put to.
	sum := sha256.Sum256([]byte("zasper/session-key\x00" + core.ServerAccessToken))
	return sum[:]
}

const (
	// sessionCookie carries a browser's session. HttpOnly, so a script running in the page — a
	// notebook output that got past the sanitiser — cannot read it and take it elsewhere.
	sessionCookie   = "zasper_session"
	sessionLifetime = 24 * time.Hour
)

// sessionUserID is the one user a Zasper server has: whoever holds its access token.
const sessionUserID = "1"

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

A token in the query string is not read. Websockets used to authenticate that way, because a browser
cannot put a header on one, and the token then sat in history, proxy logs and anything the URL was
pasted into; the cookie reaches a websocket upgrade without any of that.
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

// parseSession validates a JWT this server issued and answers the session it names.
func parseSession(tokenStr string) (session, error) {
	if tokenStr == "" {
		return session{}, fmt.Errorf("missing credentials")
	}

	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		// Make sure the signing method is HMAC
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return sessionKey(), nil
	})
	if err != nil || !token.Valid {
		return session{}, fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return session{}, fmt.Errorf("invalid token claims")
	}

	// Comma-ok rather than a bare assertion: a token carrying user_id as a JSON number is still a
	// correctly signed token, and asserting on it would panic the handler.
	userID, ok := claims["user_id"].(string)
	if !ok || userID == "" {
		return session{}, fmt.Errorf("invalid token claims")
	}
	// The id is what signing out revokes, and the expiry is how long that has to be remembered, so a
	// token without either cannot be signed out and is not accepted.
	id, ok := claims["jti"].(string)
	if !ok || id == "" {
		return session{}, fmt.Errorf("invalid token claims")
	}
	expires, err := claims.GetExpirationTime()
	if err != nil || expires == nil {
		return session{}, fmt.Errorf("invalid token claims")
	}

	if isRevoked(id) {
		return session{}, fmt.Errorf("this session has been signed out")
	}
	return session{userID: userID, id: id, expires: expires.Time}, nil
}

// userFromToken validates a JWT and answers the user id it carries.
func userFromToken(tokenStr string) (string, error) {
	s, err := parseSession(tokenStr)
	return s.userID, err
}

/*
crossSiteWrite reports whether a request changes something and came from a page other than Zasper's.

A browser attaches the session cookie to any request for this host, including one a page on another
site makes. SameSite=Strict stops a different site, but not another app on this machine, which is the
same site on another port. So a request that is authenticated by the cookie and changes something has
to come from Zasper's own page. Reads are left alone, because another origin cannot see what they
answer.
*/
func crossSiteWrite(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return !zhttp.SameOrigin(r)
}

// authenticate gates a route on the session the request carries.
func authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, fromCookie := sessionToken(r)
		s, err := parseSession(token)
		if err != nil {
			zhttp.SendErrorResponse(w, http.StatusUnauthorized, err.Error())
			return
		}
		if fromCookie && crossSiteWrite(r) {
			zhttp.SendErrorResponse(w, http.StatusForbidden, "this request did not come from Zasper's own page")
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, s.userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// JwtAuthMiddleware gates a REST route.
func JwtAuthMiddleware(next http.Handler) http.Handler {
	return authenticate(next)
}

// JwtWebsocketMiddleware gates a websocket route. The upgrade is a GET, and the websocket handlers
// check its Origin themselves.
func JwtWebsocketMiddleware(next http.Handler) http.Handler {
	return authenticate(next)
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

/*
LoginHandler trades the access token for a session: set as a cookie for the browser, and also in the
answer for a script, which sends it back as a bearer token.
*/
func LoginHandler(w http.ResponseWriter, r *http.Request) {
	client := clientAddress(r)
	if wait := logins.blocked(client, time.Now()); wait > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
		zhttp.SendErrorResponse(w, http.StatusTooManyRequests, "Too many failed sign-ins; try again in a minute")
		return
	}

	var creds struct {
		AccessToken string `json:"accessToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid request")
		return
	}

	// Constant time, so that the answer does not say how much of the token was right.
	if subtle.ConstantTimeCompare([]byte(creds.AccessToken), []byte(core.ServerAccessToken)) != 1 {
		logins.failed(client, time.Now())
		zhttp.SendErrorResponse(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}
	logins.succeeded(client)

	id, err := core.GenerateRandomToken(16)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, "Could not generate token")
		return
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": sessionUserID,
		"jti":     id,
		"exp":     time.Now().Add(sessionLifetime).Unix(),
	})
	tokenString, err := token.SignedString(sessionKey())
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, "Could not generate token")
		return
	}

	http.SetCookie(w, sessionCookieFor(r, tokenString, int(sessionLifetime.Seconds())))
	zhttp.SendJSON(w, http.StatusOK, LoginResponse{Token: tokenString, RedirectPath: "/"})
}

/*
LogoutHandler signs a session out. It is revoked on the server, so a copy of the token held anywhere
else stops working too, and the browser is told to drop the cookie. A request without a valid session
still has its cookie cleared and answers 204: there is nothing left to sign out.
*/
func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	token, fromCookie := sessionToken(r)
	if fromCookie && crossSiteWrite(r) {
		zhttp.SendErrorResponse(w, http.StatusForbidden, "this request did not come from Zasper's own page")
		return
	}
	if s, err := parseSession(token); err == nil {
		revoke(s.id, s.expires)
	}

	http.SetCookie(w, sessionCookieFor(r, "", -1))
	w.WriteHeader(http.StatusNoContent)
}
