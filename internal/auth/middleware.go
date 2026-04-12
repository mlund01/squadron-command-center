package auth

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

type ctxKey int

const sessionContextKey ctxKey = iota

// SessionFromContext returns the authenticated session attached to the
// request context by Middleware, or nil if the request was not authenticated
// (e.g. auth disabled, or path exempt from auth).
func SessionFromContext(ctx context.Context) *Session {
	s, _ := ctx.Value(sessionContextKey).(*Session)
	return s
}

// Middleware gates requests behind a valid session cookie.
// Paths under /auth/ are exempt so the login flow can complete.
func (p *Provider) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/auth/") {
			next.ServeHTTP(w, r)
			return
		}

		cookie, err := r.Cookie(p.cfg.CookieName)
		if err == nil {
			if sess, err := decodeSession(cookie.Value, p.cfg.CookieSecret); err == nil {
				ctx := context.WithValue(r.Context(), sessionContextKey, sess)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}

		// Unauthenticated. HTML GET requests get a redirect to the login
		// handler so the user lands on the IdP. Everything else (API calls,
		// non-GET methods) gets a JSON 401 so the frontend can handle it.
		if r.Method == http.MethodGet && strings.Contains(r.Header.Get("Accept"), "text/html") {
			redirectPath := r.URL.Path
			if r.URL.RawQuery != "" {
				redirectPath += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, "/auth/login?next="+url.QueryEscape(redirectPath), http.StatusFound)
			return
		}

		writeUnauthorized(w)
	})
}
