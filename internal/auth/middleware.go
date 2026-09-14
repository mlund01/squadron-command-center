package auth

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"
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

// WithSession attaches a verified session to a request context. Authentication
// middleware uses this before handing requests to downstream authorization.
func WithSession(ctx context.Context, session *Session) context.Context {
	return context.WithValue(ctx, sessionContextKey, session)
}

// Middleware gates requests behind a valid session cookie.
// Paths under /auth/ are exempt so the login flow can complete.
func (p *Provider) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/auth/") || r.URL.Path == "/login" || r.URL.Path == "/invite" || r.URL.Path == "/api/auth/login" || r.URL.Path == "/api/auth/invitation" || r.URL.Path == "/setup" || r.URL.Path == "/api/setup" || isPublicAsset(r) {
			next.ServeHTTP(w, r)
			return
		}
		if p.servicePrincipals != nil {
			header := r.Header.Get("Authorization")
			if strings.HasPrefix(header, "Bearer sp_") {
				principal, err := p.servicePrincipals.AuthenticateServicePrincipal(r.Context(), strings.TrimPrefix(header, "Bearer "))
				if err == nil {
					ctx := WithSession(r.Context(), &Session{Kind: "service_principal", Sub: principal.ID, Name: principal.Name, Expires: time.Now().Add(time.Hour).Unix()})
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
			}
		}

		cookie, err := r.Cookie(p.cfg.CookieName)
		if err == nil {
			if sess, err := decodeSession(cookie.Value, p.cfg.CookieSecret); err == nil {
				ctx := WithSession(r.Context(), sess)
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

// isPublicAsset permits the compiled frontend resources needed for login and
// first-run setup before a browser has an authenticated session.
func isPublicAsset(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	return strings.HasPrefix(r.URL.Path, "/assets/") ||
		r.URL.Path == "/favicon.svg" ||
		r.URL.Path == "/squadron-logo.svg"
}
