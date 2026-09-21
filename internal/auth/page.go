package auth

import (
	"errors"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
)

// Why a session cookie no longer works, as /login?reason= names it for the sign-in page.
const (
	EndedRestarted = "restarted"
	EndedExpired   = "expired"
	EndedSignedOut = "signed-out"
)

/*
pageSession answers whether the request's session cookie is live, and if not, why it ended: "" when
there is no cookie or nothing more specific can be said. A signature from another key means the server
restarted with a new access token.
*/
func (a *Auth) pageSession(r *http.Request) (live bool, ended string) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return false, ""
	}
	_, err = a.parseSession(cookie.Value)
	switch {
	case err == nil:
		return true, ""
	case errors.Is(err, jwt.ErrTokenSignatureInvalid):
		return false, EndedRestarted
	case errors.Is(err, jwt.ErrTokenExpired):
		return false, EndedExpired
	case errors.Is(err, errSignedOut):
		return false, EndedSignedOut
	}
	return false, ""
}

/*
PageGate decides between the IDE and the sign-in page before any HTML is sent, so a browser with a dead
session is never shown the IDE first. The access-token link, `/?token=…`, goes through: that is how it
signs in.
*/
func (a *Auth) PageGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			next.ServeHTTP(w, r)
			return
		}

		switch r.URL.Path {
		case "/":
			if r.URL.Query().Has("token") {
				break
			}
			if live, ended := a.pageSession(r); !live {
				target := "/login"
				if ended != "" {
					target += "?reason=" + ended
				}
				http.Redirect(w, r, target, http.StatusFound)
				return
			}
		case "/login":
			live, ended := a.pageSession(r)
			if live {
				http.Redirect(w, r, "/", http.StatusFound)
				return
			}
			// The session-ended notice and the IDE's own 401 both arrive here without one.
			if ended != "" && !r.URL.Query().Has("reason") {
				http.Redirect(w, r, "/login?reason="+ended, http.StatusFound)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
