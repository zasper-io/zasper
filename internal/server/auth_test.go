/*
Protected mode, over the real route table.

These walk the router rather than listing paths, so a route added later is covered without anyone
remembering to add it here. That is the whole point: every one of the three defects these cover was a
route that had simply been left out of the gate — the two websocket routes were never behind it, and
the watcher was behind the one gate a browser cannot pass.

Each test starts a server of its own. All but the one that pins the access token run in parallel.
*/
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/core"
)

// The routes that answer before anyone is authenticated: the health check, the config the login page
// reads to know it should ask for a token, and the login itself.
var openRoutes = map[string]bool{
	"/api/health": true,
	"/api/config": true,
	"/auth/login": true,
	// Signing out answers 204 to anyone, since without a session there is nothing to refuse.
	"/auth/logout": true,
}

// protectedServer starts the real route table with protected mode on, and answers with the server and
// the access token printed at boot.
func protectedServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()

	project := filepath.Join(t.TempDir(), "project")
	require.NoError(t, os.MkdirAll(project, 0o755))

	s := New(core.NewApplication("test", project))

	srv := httptest.NewServer(s.Router(nil))
	t.Cleanup(srv.Close)

	return srv, s.app.AccessToken
}

// route is one entry of the table, with its path variables filled in so it can actually be called.
type route struct {
	method string
	path   string
}

// tableRoutes walks the router for every route that carries a handler. The subrouters themselves have
// none, which is how they are told apart from the routes registered on them.
func tableRoutes(t *testing.T, router *mux.Router) []route {
	t.Helper()

	var routes []route
	err := router.Walk(func(r *mux.Route, _ *mux.Router, _ []*mux.Route) error {
		if r.GetHandler() == nil {
			return nil
		}

		template, err := r.GetPathTemplate()
		if err != nil {
			return nil
		}
		if openRoutes[template] {
			return nil
		}

		// A route registered without .Methods() answers to any of them; the websocket routes are the
		// ones that do that.
		methods, err := r.GetMethods()
		if err != nil || len(methods) == 0 {
			methods = []string{http.MethodGet}
		}

		for _, method := range methods {
			routes = append(routes, route{method: method, path: fillVars(template)})
		}
		return nil
	})
	require.NoError(t, err)
	require.NotEmpty(t, routes, "walked the router and found no routes to check")

	return routes
}

// fillVars turns a path template into a path, by giving every {variable} a value. Which value does not
// matter: an unauthenticated request must be turned away before any handler looks at it.
func fillVars(template string) string {
	segments := strings.Split(template, "/")
	for i, segment := range segments {
		if strings.HasPrefix(segment, "{") && strings.HasSuffix(segment, "}") {
			segments[i] = "placeholder"
		}
	}
	return strings.Join(segments, "/")
}

/*
The gate, over every route there is.

Two of these used to pass anonymously: /ws/terminals/{id} handed out a shell, and
/ws/kernels/{id}/channels attached to a running kernel.
*/
func TestProtectedModeRejectsEveryAnonymousRequest(t *testing.T) {
	t.Parallel()

	srv, _ := protectedServer(t)

	for _, route := range tableRoutes(t, srv.Config.Handler.(*mux.Router)) {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			request, err := http.NewRequest(route.method, srv.URL+route.path, nil)
			require.NoError(t, err)

			response, err := http.DefaultClient.Do(request)
			require.NoError(t, err)
			defer response.Body.Close()

			assert.Equal(t, http.StatusUnauthorized, response.StatusCode)
		})
	}
}

// The token the login hands back opens the API, or protected mode would reject its own frontend too.
func TestProtectedModeAcceptsTheLoginToken(t *testing.T) {
	t.Parallel()

	srv, accessToken := protectedServer(t)
	jwt := login(t, srv, accessToken)

	request, err := http.NewRequest(http.MethodGet, srv.URL+"/api/info", nil)
	require.NoError(t, err)
	request.Header.Set("Authorization", "Bearer "+jwt)

	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer response.Body.Close()

	assert.Equal(t, http.StatusOK, response.StatusCode)
}

// Signing in is read before anyone is authenticated, so its body is capped at a few kilobytes: a
// valid sign-in padded past that is refused, where it used to be read however large it was.
func TestASignInLargerThanASignInIsNotRead(t *testing.T) {
	t.Parallel()

	srv, accessToken := protectedServer(t)
	body, err := json.Marshal(map[string]string{
		"padding":     strings.Repeat("x", 32<<10),
		"accessToken": accessToken,
	})
	require.NoError(t, err)

	response, err := http.Post(srv.URL+"/auth/login", "application/json", strings.NewReader(string(body)))
	require.NoError(t, err)
	defer response.Body.Close()

	assert.Equal(t, http.StatusBadRequest, response.StatusCode)
}

// The cookie the login sets is what a browser authenticates the API with.
func TestTheSessionCookieOpensTheAPI(t *testing.T) {
	t.Parallel()

	srv, accessToken := protectedServer(t)
	body, err := json.Marshal(map[string]string{"accessToken": accessToken})
	require.NoError(t, err)

	signedIn, err := http.Post(srv.URL+"/auth/login", "application/json", strings.NewReader(string(body)))
	require.NoError(t, err)
	defer signedIn.Body.Close()
	require.Equal(t, http.StatusOK, signedIn.StatusCode)

	var session *http.Cookie
	for _, cookie := range signedIn.Cookies() {
		if cookie.Name == "zasper_session" {
			session = cookie
		}
	}
	require.NotNil(t, session, "signing in set no session cookie")

	request, err := http.NewRequest(http.MethodGet, srv.URL+"/api/info", nil)
	require.NoError(t, err)
	request.AddCookie(session)
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer response.Body.Close()

	assert.Equal(t, http.StatusOK, response.StatusCode)
}

// ZASPER_ACCESS_TOKEN replaces the random token, so a link or a script can carry it across restarts.
func TestLoginAcceptsAPinnedAccessToken(t *testing.T) {
	t.Setenv("ZASPER_ACCESS_TOKEN", "pinned-token")
	srv, accessToken := protectedServer(t)

	assert.Equal(t, "pinned-token", accessToken)
	login(t, srv, "pinned-token")
}

func TestLoginRejectsTheWrongAccessToken(t *testing.T) {
	t.Parallel()

	srv, _ := protectedServer(t)

	response, err := http.Post(
		srv.URL+"/auth/login",
		"application/json",
		strings.NewReader(`{"accessToken":"not-the-token"}`),
	)
	require.NoError(t, err)
	defer response.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, response.StatusCode)
}

/*
Websockets authenticate by the session cookie, which a browser sends on the upgrade. A token in the URL
is refused: it used to be how they authenticated, and it left the token in history and logs.
*/
func TestWebsocketsAuthenticateByTheSessionCookie(t *testing.T) {
	t.Parallel()

	srv, accessToken := protectedServer(t)
	jwt := login(t, srv, accessToken)

	for _, path := range []string{"/api/contents/watch", "/ws/terminals/placeholder"} {
		t.Run(path, func(t *testing.T) {
			_, response, err := websocket.DefaultDialer.Dial(wsURL(t, srv, path)+"?token="+jwt, nil)
			require.Error(t, err, "the socket opened with the token in its URL")
			require.NotNil(t, response)
			assert.Equal(t, http.StatusUnauthorized, response.StatusCode)

			header := http.Header{"Cookie": []string{"zasper_session=" + jwt}}
			conn, _, err := websocket.DefaultDialer.Dial(wsURL(t, srv, path), header)
			require.NoError(t, err, "the socket refused a valid session cookie")
			conn.Close()
		})
	}
}

/*
A websocket is not same-origin by default the way fetch is, so without a CheckOrigin of our own any
page open in the browser could reach these with a session it had got hold of.
*/
func TestWebsocketsRefuseAForeignOrigin(t *testing.T) {
	srv, _ := testServer(t)

	for _, path := range []string{"/api/contents/watch", "/ws/terminals/placeholder"} {
		t.Run(path, func(t *testing.T) {
			header := http.Header{"Origin": []string{"https://evil.example.com"}}
			_, response, err := websocket.DefaultDialer.Dial(wsURL(t, srv, path), header)
			require.Error(t, err)
			require.NotNil(t, response)
			assert.Equal(t, http.StatusForbidden, response.StatusCode)

			// The same server, asked from the page it serves.
			header = http.Header{"Origin": []string{srv.URL}}
			conn, _, err := websocket.DefaultDialer.Dial(wsURL(t, srv, path), header)
			require.NoError(t, err, "refused its own origin")
			conn.Close()
		})
	}
}

func login(t *testing.T, srv *httptest.Server, accessToken string) string {
	t.Helper()

	body, err := json.Marshal(map[string]string{"accessToken": accessToken})
	require.NoError(t, err)

	response, err := http.Post(srv.URL+"/auth/login", "application/json", strings.NewReader(string(body)))
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, http.StatusOK, response.StatusCode)

	var answer struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.NewDecoder(response.Body).Decode(&answer))
	require.NotEmpty(t, answer.Token)

	return answer.Token
}
