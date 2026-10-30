package httpx

import (
	"fmt"
	"net/http"
	"strings"
)

/*
BasePath reads where the server is served from, given on the command line or in ZASPER_BASE_URL: a
path such as /user/prasun/, which a hub puts each person's server under. The first that is set wins. It
comes back with a slash at each end, and as "/" when neither is set.

Only letters, digits and - . _ ~ between slashes: the path goes into a <base> element, a cookie's Path
and every redirect, so anything that would need escaping in one of them is refused rather than escaped
three different ways.
*/
func BasePath(values ...string) (string, error) {
	value := ""
	for _, v := range values {
		if v = strings.TrimSpace(v); v != "" {
			value = v
			break
		}
	}
	if value == "" || value == "/" {
		return "/", nil
	}
	if !strings.HasPrefix(value, "/") {
		return "", fmt.Errorf("%q is not a path: it starts with /, such as /user/prasun/", value)
	}
	// One slash off each end, not every one: //evil.example.com/ is another host to a browser.
	segments := strings.Split(strings.TrimSuffix(value[1:], "/"), "/")
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return "", fmt.Errorf("%q has an empty, . or .. part", value)
		}
		for _, c := range segment {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("-._~", c)) {
				return "", fmt.Errorf("%q has %q in it: only letters, digits and - . _ ~ between slashes", value, c)
			}
		}
	}
	return "/" + strings.Join(segments, "/") + "/", nil
}

/*
UnderBase serves next at base as though base were the root, so the routes, the frontend and every
check behind it are written for "/" alone. base itself without its last slash is redirected to base,
because the page's relative links resolve against a directory; anything outside base is not found.
*/
func UnderBase(base string, next http.Handler) http.Handler {
	if base == "/" {
		return next
	}
	bare := strings.TrimSuffix(base, "/")
	strip := http.StripPrefix(bare, next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == bare:
			target := base
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusMovedPermanently)
		case strings.HasPrefix(r.URL.Path, base):
			strip.ServeHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}
