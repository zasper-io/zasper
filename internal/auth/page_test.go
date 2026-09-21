package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
)

func pageRequest(a *Auth, method, target, cookie string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, nil)
	if cookie != "" {
		r.AddCookie(&http.Cookie{Name: sessionCookie, Value: cookie})
	}
	recorder := httptest.NewRecorder()
	a.PageGate(answers(http.StatusOK)).ServeHTTP(recorder, r)
	return recorder
}

func TestTheIDEPageIsSentOnlyToALiveSession(t *testing.T) {
	a := gate(t, "the-token")
	expired := validClaims()
	expired["exp"] = time.Now().Add(-time.Minute).Unix()
	signedOut := validClaims()
	signedOut["jti"] = "signed-out"
	a.revoked.add("signed-out", time.Now().Add(time.Hour))

	cases := []struct {
		name, cookie, location string
	}{
		{"live", signedWith(t, a.key, validClaims()), ""},
		{"no cookie", "", "/login"},
		{"not a token", "garbage", "/login"},
		{"server restarted", signedWith(t, New("the-old-token").key, validClaims()), "/login?reason=restarted"},
		{"expired", signedWith(t, a.key, expired), "/login?reason=expired"},
		{"signed out", signedWith(t, a.key, signedOut), "/login?reason=signed-out"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			recorder := pageRequest(a, http.MethodGet, "/", c.cookie)

			if c.location == "" {
				assert.Equal(t, http.StatusOK, recorder.Code)
				return
			}
			assert.Equal(t, http.StatusFound, recorder.Code)
			assert.Equal(t, c.location, recorder.Header().Get("Location"))
		})
	}
}

func TestTheSignInPageSendsALiveSessionToTheIDE(t *testing.T) {
	a := gate(t, "the-token")

	live := pageRequest(a, http.MethodGet, "/login", signedWith(t, a.key, validClaims()))
	assert.Equal(t, http.StatusFound, live.Code)
	assert.Equal(t, "/", live.Header().Get("Location"))

	dead := pageRequest(a, http.MethodGet, "/login?reason=restarted", signedWith(t, []byte("elsewhere"), validClaims()))
	assert.Equal(t, http.StatusOK, dead.Code)

	assert.Equal(t, http.StatusOK, pageRequest(a, http.MethodGet, "/login", "").Code)
}

func TestTheSignInPageIsToldWhyWhenNobodySaid(t *testing.T) {
	a := gate(t, "the-token")
	restarted := signedWith(t, New("the-old-token").key, validClaims())

	bare := pageRequest(a, http.MethodGet, "/login", restarted)
	assert.Equal(t, http.StatusFound, bare.Code)
	assert.Equal(t, "/login?reason=restarted", bare.Header().Get("Location"))

	// A reason already given is kept, so this cannot loop.
	assert.Equal(t, http.StatusOK, pageRequest(a, http.MethodGet, "/login?reason=restarted", restarted).Code)
}

func TestTheGateLetsThroughWhatIsNotItsToDecide(t *testing.T) {
	a := gate(t, "the-token")

	for _, target := range []string{"/?token=from-the-terminal", "/assets/index-3f9a1c.js", "/favicon-16.png"} {
		assert.Equal(t, http.StatusOK, pageRequest(a, http.MethodGet, target, "").Code, target)
	}
	assert.Equal(t, http.StatusOK, pageRequest(a, http.MethodPost, "/", "").Code)
}

// The reason comes from jwt's own errors, so a change in how it reports them should fail here.
func TestARefusedTokenStillAnswersInvalidToken(t *testing.T) {
	a := gate(t, "the-token")

	_, err := a.parseSession(signedWith(t, []byte("elsewhere"), validClaims()))

	assert.EqualError(t, err, "invalid token")
	assert.ErrorIs(t, err, jwt.ErrTokenSignatureInvalid)
}
