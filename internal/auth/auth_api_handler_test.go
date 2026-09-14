/*
Reading and validating a session, signing in and signing out, at the level the router cannot reach.

internal/server/auth_test.go walks the whole route table and proves every route is gated, which is
the question that matters for a route being added later. It cannot say much about *why* a token was
refused: every rejection there is one 401. These are the shapes of a bad token — a signature from
somebody else's secret, an algorithm the caller chose, an expiry that has passed, and a `user_id`
that is not a string, which is the case the comma-ok in parseSession exists for and which a bare
assertion would turn into a panicked handler.

Each test builds a gate of its own, so they run in parallel.
*/
package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// signedWith mints a token from the given claims, using `secret` — which is the server's own unless
// a test is asking what happens when it is not.
func signedWith(t *testing.T, secret []byte, claims jwt.MapClaims) string {
	t.Helper()

	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
	require.NoError(t, err)
	return token
}

// validClaims is a token the server would itself have issued: Login's shape.
func validClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"user_id": "1",
		"jti":     "a-session",
		"exp":     time.Now().Add(time.Hour).Unix(),
	}
}

// gate builds the gate for a server whose access token is token, and runs the test in parallel.
func gate(t *testing.T, token string) *Auth {
	t.Helper()
	t.Parallel()

	return New(token)
}

func requestWith(header string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/info", nil)
	if header != "" {
		r.Header.Set("Authorization", header)
	}
	return r
}

func answers(status int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(status) })
}

func TestBearerTokenReadsOnlyAWellFormedHeader(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		header string
		want   string
	}{
		"no header":                {"", ""},
		"the scheme and a token":   {"Bearer abc.def.ghi", "abc.def.ghi"},
		"a lowercase scheme":       {"bearer abc.def.ghi", "abc.def.ghi"},
		"a shouted scheme":         {"BEARER abc.def.ghi", "abc.def.ghi"},
		"the scheme and nothing":   {"Bearer ", ""},
		"the scheme with no space": {"Bearerabc", ""},
		"the scheme alone":         {"Bearer", ""},
		"somebody else's scheme":   {"Basic dXNlcjpwYXNz", ""},
		"a bare token":             {"abc.def.ghi", ""},
		// Only the first space is the separator, so whatever follows is the token verbatim — a
		// padded header is a bad token rather than no token, and says so as a 401 either way.
		"a padded token": {"Bearer  abc", " abc"},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, c.want, bearerToken(requestWith(c.header)))
		})
	}
}

func TestASessionIsReadFromTheHeaderOrTheCookie(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		header, cookie string
		want           string
		fromCookie     bool
	}{
		"neither":                  {"", "", "", false},
		"the cookie alone":         {"", "from-cookie", "from-cookie", true},
		"the header alone":         {"Bearer from-header", "", "from-header", false},
		"both, the header winning": {"Bearer from-header", "from-cookie", "from-header", false},
		// An unusable header is no header, so the cookie still gets its turn.
		"an unusable header and a cookie": {"Basic nope", "from-cookie", "from-cookie", true},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			r := requestWith(c.header)
			if c.cookie != "" {
				r.AddCookie(&http.Cookie{Name: sessionCookie, Value: c.cookie})
			}

			token, fromCookie := sessionToken(r)

			assert.Equal(t, c.want, token)
			assert.Equal(t, c.fromCookie, fromCookie)
		})
	}
}

// A token in a URL ends up in history, logs and anything the URL is pasted into.
func TestATokenInTheQueryStringIsNotASession(t *testing.T) {
	a := gate(t, "the-token")
	r := httptest.NewRequest(http.MethodGet, "/ws/terminals/x?token="+signedWith(t, a.key, validClaims()), nil)
	recorder := httptest.NewRecorder()

	a.WebsocketMiddleware(answers(http.StatusNoContent)).ServeHTTP(recorder, r)

	assert.Equal(t, http.StatusUnauthorized, recorder.Code)
}

func TestAValidTokenAnswersWithItsUser(t *testing.T) {
	a := gate(t, "the-token")
	userID, err := a.userFromToken(signedWith(t, a.key, validClaims()))

	require.NoError(t, err)
	assert.Equal(t, "1", userID)
}

func TestATokenIsRefusedUnlessThisServerIssuedIt(t *testing.T) {
	a := gate(t, "the-token")
	expired := validClaims()
	expired["exp"] = time.Now().Add(-time.Minute).Unix()

	numericUser := validClaims()
	numericUser["user_id"] = 1

	noUser := validClaims()
	delete(noUser, "user_id")

	emptyUser := validClaims()
	emptyUser["user_id"] = ""

	noID := validClaims()
	delete(noID, "jti")

	noExpiry := validClaims()
	delete(noExpiry, "exp")

	cases := map[string]string{
		"nothing at all":       "",
		"not a jwt":            "abc.def.ghi",
		"not even three parts": "abc",
		// Somebody else's secret. This is the one that matters most: everything else about the
		// token can be right.
		"signed with another secret": signedWith(t, []byte("a different secret entirely"), validClaims()),
		"expired":                    signedWith(t, a.key, expired),
		// A signed token whose user_id is a JSON number. The claims are valid JWT; it is the type
		// that is wrong, and asserting on it without the comma-ok would panic the handler.
		"a numeric user_id": signedWith(t, a.key, numericUser),
		"no user_id":        signedWith(t, a.key, noUser),
		"an empty user_id":  signedWith(t, a.key, emptyUser),
		// Neither could be signed out.
		"no session id": signedWith(t, a.key, noID),
		"no expiry":     signedWith(t, a.key, noExpiry),
	}

	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			userID, err := a.userFromToken(token)

			assert.Error(t, err, "the token was accepted")
			assert.Empty(t, userID)
		})
	}
}

/*
An algorithm the caller chose is not an algorithm this server accepts.

`alg: none` is the classic: a token with a valid-looking header, real claims, and no signature at
all. The keyfunc refuses anything that is not HMAC before the signature is even checked, which is
what stops both this and an RS256 token signed with the HMAC secret as its public key.
*/
func TestATokenCannotChooseItsOwnAlgorithm(t *testing.T) {
	a := gate(t, "the-token")
	unsigned, err := jwt.NewWithClaims(jwt.SigningMethodNone, validClaims()).
		SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	userID, err := a.userFromToken(unsigned)

	assert.Error(t, err)
	assert.Empty(t, userID)
}

// The middleware puts the user on the request context, and UserID is how a handler would read it
// back. Nothing reads it today, so this is the test that keeps the two halves in step.
func TestAnAuthenticatedRequestCarriesItsUser(t *testing.T) {
	a := gate(t, "the-token")
	var got string
	var found bool

	handler := a.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got, found = UserID(r.Context())
	}))

	request := requestWith("Bearer " + signedWith(t, a.key, validClaims()))
	handler.ServeHTTP(httptest.NewRecorder(), request)

	assert.True(t, found)
	assert.Equal(t, "1", got)

	// And a request that never went through the middleware carries nothing, rather than an empty
	// string a caller might mistake for a user.
	_, found = UserID(httptest.NewRequest(http.MethodGet, "/", nil).Context())
	assert.False(t, found)
}

// The signing key is derived from the access token, which is what replaces the removed
// ZASPER_JWT_SECRET: a session stays valid for as long as the token it was traded for does, so a
// restart that mints a fresh token signs everyone out and a pinned one does not.
func TestSessionKeyFollowsAccessToken(t *testing.T) {
	first := gate(t, "the-first-token")
	session := signedWith(t, first.key, validClaims())
	userID, err := first.userFromToken(session)
	require.NoError(t, err)
	assert.Equal(t, "1", userID)

	// The same token derives the same key, so a session outlives a restart that pins it.
	_, err = New("the-first-token").userFromToken(session)
	assert.NoError(t, err)

	_, err = New("a-different-token").userFromToken(session)
	assert.Error(t, err)
}

// signIn posts an access token to Login as client would.
func signIn(t *testing.T, a *Auth, accessToken, client string) *httptest.ResponseRecorder {
	t.Helper()

	r := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(`{"accessToken": "`+accessToken+`"}`))
	r.RemoteAddr = client + ":40000"
	recorder := httptest.NewRecorder()
	a.Login(recorder, r)
	return recorder
}

func sessionCookieIn(t *testing.T, recorder *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()

	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == sessionCookie {
			return cookie
		}
	}
	t.Fatal("no session cookie was set")
	return nil
}

// A request to localhost:8048 carrying the session cookie, and Origin when there is one.
func cookieRequest(method, path, token, origin string) *http.Request {
	r := httptest.NewRequest(method, "http://localhost:8048"+path, nil)
	r.Host = "localhost:8048"
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	return r
}

func TestSigningInSetsASessionCookieThatScriptsCannotRead(t *testing.T) {
	a := gate(t, "the-token")

	recorder := signIn(t, a, "the-token", "192.0.2.1")

	require.Equal(t, http.StatusOK, recorder.Code, "body was %s", recorder.Body)
	cookie := sessionCookieIn(t, recorder)
	assert.True(t, cookie.HttpOnly)
	assert.Equal(t, http.SameSiteStrictMode, cookie.SameSite)
	assert.Equal(t, "/", cookie.Path)
	assert.Equal(t, int(sessionLifetime.Seconds()), cookie.MaxAge)

	userID, err := a.userFromToken(cookie.Value)
	require.NoError(t, err)
	assert.Equal(t, "1", userID)
}

// Another app on this machine is the same site on another port, so SameSite=Strict still sends the
// cookie with its requests.
func TestASessionCookieCannotChangeAnythingFromAnotherPage(t *testing.T) {
	a := gate(t, "the-token")
	token := signedWith(t, a.key, validClaims())

	cases := map[string]struct {
		method, origin string
		bearer         bool
		want           int
	}{
		"a save from Zasper's own page":           {http.MethodPut, "http://localhost:8048", false, http.StatusNoContent},
		"a save from a client that is no browser": {http.MethodPut, "", false, http.StatusNoContent},
		"a save from another site":                {http.MethodPut, "https://evil.example.com", false, http.StatusForbidden},
		"a delete from another app on this host":  {http.MethodDelete, "http://localhost:9999", false, http.StatusForbidden},
		"a read from another site":                {http.MethodGet, "https://evil.example.com", false, http.StatusNoContent},
		// A page cannot set Authorization on a request to another origin without a preflight, which
		// this server does not grant.
		"a save carrying the header": {http.MethodPut, "https://evil.example.com", true, http.StatusNoContent},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			r := cookieRequest(c.method, "/api/contents", token, c.origin)
			if c.bearer {
				r.Header.Del("Cookie")
				r.Header.Set("Authorization", "Bearer "+token)
			}
			recorder := httptest.NewRecorder()

			a.Middleware(answers(http.StatusNoContent)).ServeHTTP(recorder, r)

			assert.Equal(t, c.want, recorder.Code)
		})
	}
}

// Signing out used to clear localStorage and nothing else, leaving the token valid for a day.
func TestSigningOutEndsTheSessionEverywhere(t *testing.T) {
	a := gate(t, "the-token")
	token := sessionCookieIn(t, signIn(t, a, "the-token", "192.0.2.1")).Value

	recorder := httptest.NewRecorder()
	a.Logout(recorder, cookieRequest(http.MethodPost, "/auth/logout", token, "http://localhost:8048"))

	assert.Equal(t, http.StatusNoContent, recorder.Code)
	assert.Negative(t, sessionCookieIn(t, recorder).MaxAge, "the browser was not told to drop the cookie")

	// A copy of the token, held by a script or another browser, stops working too.
	afterwards := httptest.NewRecorder()
	a.Middleware(answers(http.StatusNoContent)).ServeHTTP(afterwards, requestWith("Bearer "+token))
	assert.Equal(t, http.StatusUnauthorized, afterwards.Code)
}

func TestAnotherPageCannotSignYouOut(t *testing.T) {
	a := gate(t, "the-token")
	token := sessionCookieIn(t, signIn(t, a, "the-token", "192.0.2.1")).Value

	recorder := httptest.NewRecorder()
	a.Logout(recorder, cookieRequest(http.MethodPost, "/auth/logout", token, "https://evil.example.com"))

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	_, err := a.userFromToken(token)
	assert.NoError(t, err)
}

func TestRepeatedFailedSignInsAreHeldOff(t *testing.T) {
	a := gate(t, "the-token")

	for attempt := range maxFailedLogins {
		assert.Equal(t, http.StatusUnauthorized, signIn(t, a, "wrong", "192.0.2.1").Code, "attempt %d", attempt+1)
	}

	held := signIn(t, a, "the-token", "192.0.2.1")
	assert.Equal(t, http.StatusTooManyRequests, held.Code, "even the right token waits out the window")
	assert.NotEmpty(t, held.Header().Get("Retry-After"))

	// Only that client is held off.
	assert.Equal(t, http.StatusOK, signIn(t, a, "the-token", "198.51.100.7").Code)

	// And the wait ends.
	assert.Zero(t, a.logins.blocked("192.0.2.1", time.Now().Add(loginWindow)))
}

func TestASuccessfulSignInForgetsEarlierFailures(t *testing.T) {
	a := gate(t, "the-token")

	for range maxFailedLogins - 1 {
		signIn(t, a, "wrong", "192.0.2.1")
	}
	require.Equal(t, http.StatusOK, signIn(t, a, "the-token", "192.0.2.1").Code)

	assert.Equal(t, http.StatusUnauthorized, signIn(t, a, "wrong", "192.0.2.1").Code)
	assert.Equal(t, http.StatusOK, signIn(t, a, "the-token", "192.0.2.1").Code)
}
