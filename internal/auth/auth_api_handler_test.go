/*
Reading and validating a token, at the level the router cannot reach.

internal/server/auth_test.go walks the whole route table and proves every route is gated, which is
the question that matters for a route being added later. It cannot say much about *why* a token was
refused: every rejection there is one 401. These are the shapes of a bad token — a signature from
somebody else's secret, an algorithm the caller chose, an expiry that has passed, and a `user_id`
that is not a string, which is the case the comma-ok in userFromToken exists for and which a bare
assertion would turn into a panicked handler.

jwtSecret is package state set once in init(), so these mint their tokens with it rather than
replacing it, and nothing here runs in parallel.
*/
package auth

import (
	"net/http"
	"net/http/httptest"
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

// validClaims is a token the server would itself have issued: LoginHandler's shape.
func validClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"user_id": "1",
		"role":    "user",
		"exp":     time.Now().Add(time.Hour).Unix(),
	}
}

func requestWith(header, query string) *http.Request {
	target := "/ws/terminals/x"
	if query != "" {
		target += "?token=" + query
	}
	r := httptest.NewRequest(http.MethodGet, target, nil)
	if header != "" {
		r.Header.Set("Authorization", header)
	}
	return r
}

func TestBearerTokenReadsOnlyAWellFormedHeader(t *testing.T) {
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
			assert.Equal(t, c.want, bearerToken(requestWith(c.header, "")))
		})
	}
}

func TestAWebsocketFallsBackToTheQueryStringButPrefersTheHeader(t *testing.T) {
	cases := map[string]struct {
		header string
		query  string
		want   string
	}{
		"neither":                  {"", "", ""},
		"the query alone":          {"", "from-query", "from-query"},
		"the header alone":         {"Bearer from-header", "", "from-header"},
		"both, the header winning": {"Bearer from-header", "from-query", "from-header"},
		// An unusable header is no header, so the query still gets its turn rather than the request
		// being refused on the strength of something the caller may not have set.
		"an unusable header and a query": {"Basic nope", "from-query", "from-query"},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, c.want, websocketToken(requestWith(c.header, c.query)))
		})
	}
}

func TestAValidTokenAnswersWithItsUser(t *testing.T) {
	userID, err := userFromToken(signedWith(t, jwtSecret, validClaims()))

	require.NoError(t, err)
	assert.Equal(t, "1", userID)
}

func TestATokenIsRefusedUnlessThisServerIssuedIt(t *testing.T) {
	expired := validClaims()
	expired["exp"] = time.Now().Add(-time.Minute).Unix()

	numericUser := validClaims()
	numericUser["user_id"] = 1

	noUser := validClaims()
	delete(noUser, "user_id")

	emptyUser := validClaims()
	emptyUser["user_id"] = ""

	cases := map[string]string{
		"nothing at all":       "",
		"not a jwt":            "abc.def.ghi",
		"not even three parts": "abc",
		// Somebody else's secret. This is the one that matters most: everything else about the
		// token can be right.
		"signed with another secret": signedWith(t, []byte("a different secret entirely"), validClaims()),
		"expired":                    signedWith(t, jwtSecret, expired),
		// A signed token whose user_id is a JSON number. The claims are valid JWT; it is the type
		// that is wrong, and asserting on it without the comma-ok would panic the handler.
		"a numeric user_id": signedWith(t, jwtSecret, numericUser),
		"no user_id":        signedWith(t, jwtSecret, noUser),
		"an empty user_id":  signedWith(t, jwtSecret, emptyUser),
	}

	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			userID, err := userFromToken(token)

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
	unsigned, err := jwt.NewWithClaims(jwt.SigningMethodNone, validClaims()).
		SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	userID, err := userFromToken(unsigned)

	assert.Error(t, err)
	assert.Empty(t, userID)
}

// The middleware puts the user on the request context, and UserID is how a handler would read it
// back. Nothing reads it today, so this is the test that keeps the two halves in step.
func TestAnAuthenticatedRequestCarriesItsUser(t *testing.T) {
	var got string
	var found bool

	handler := JwtAuthMiddleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got, found = UserID(r.Context())
	}))

	request := requestWith("Bearer "+signedWith(t, jwtSecret, validClaims()), "")
	handler.ServeHTTP(httptest.NewRecorder(), request)

	assert.True(t, found)
	assert.Equal(t, "1", got)

	// And a request that never went through the middleware carries nothing, rather than an empty
	// string a caller might mistake for a user.
	_, found = UserID(httptest.NewRequest(http.MethodGet, "/", nil).Context())
	assert.False(t, found)
}
