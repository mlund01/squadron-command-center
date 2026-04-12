package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// testProvider builds a Provider with just cfg populated (no real OIDC
// discovery). Good enough for middleware and handler tests that only
// touch cookies and config.
func testProvider(t *testing.T) *Provider {
	t.Helper()
	return &Provider{
		cfg: &Config{
			CookieSecret: testSecret,
			CookieName:   "test_session",
			CookieSecure: false,
			SessionTTL:   time.Hour,
		},
	}
}

func validSessionCookie(t *testing.T, p *Provider) *http.Cookie {
	t.Helper()
	sess := Session{
		Sub:     "user-1",
		Email:   "test@example.com",
		Name:    "Test User",
		Expires: time.Now().Add(time.Hour).Unix(),
	}
	val, err := encodeSession(sess, p.cfg.CookieSecret)
	if err != nil {
		t.Fatalf("encode session: %v", err)
	}
	return &http.Cookie{Name: p.cfg.CookieName, Value: val}
}

func TestMiddleware_ValidSession(t *testing.T) {
	p := testProvider(t)
	var called bool
	var gotSession *Session

	handler := p.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		gotSession = SessionFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/instances", nil)
	req.AddCookie(validSessionCookie(t, p))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("next handler was not called")
	}
	if gotSession == nil {
		t.Fatal("session not in context")
	}
	if gotSession.Email != "test@example.com" {
		t.Errorf("session email = %q", gotSession.Email)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestMiddleware_NoCookie_APIRequest(t *testing.T) {
	p := testProvider(t)
	var called bool

	handler := p.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))

	req := httptest.NewRequest("GET", "/api/instances", nil)
	req.Header.Set("Accept", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if called {
		t.Error("next handler should not be called for unauthenticated API request")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["error"] != "unauthorized" {
		t.Errorf("body = %v", body)
	}
}

func TestMiddleware_NoCookie_HTMLRedirect(t *testing.T) {
	p := testProvider(t)

	handler := p.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("next handler should not be called")
	}))

	req := httptest.NewRequest("GET", "/instances/abc/missions", nil)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if loc == "" {
		t.Fatal("missing Location header")
	}
	if loc != "/auth/login?next=%2Finstances%2Fabc%2Fmissions" {
		t.Errorf("Location = %q", loc)
	}
}

func TestMiddleware_NoCookie_HTMLRedirectWithQuery(t *testing.T) {
	p := testProvider(t)

	handler := p.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("next handler should not be called")
	}))

	req := httptest.NewRequest("GET", "/instances/abc/costs?from=2026-01-01", nil)
	req.Header.Set("Accept", "text/html")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	loc := rec.Header().Get("Location")
	// Should preserve the query string in the next parameter
	if loc != "/auth/login?next=%2Finstances%2Fabc%2Fcosts%3Ffrom%3D2026-01-01" {
		t.Errorf("Location = %q", loc)
	}
}

func TestMiddleware_ExpiredSession(t *testing.T) {
	p := testProvider(t)

	sess := Session{
		Email:   "old@example.com",
		Expires: time.Now().Add(-time.Minute).Unix(),
	}
	val, err := encodeSession(sess, p.cfg.CookieSecret)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	handler := p.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("next handler should not be called for expired session")
	}))

	req := httptest.NewRequest("GET", "/api/instances", nil)
	req.AddCookie(&http.Cookie{Name: p.cfg.CookieName, Value: val})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
}

func TestMiddleware_TamperedCookie(t *testing.T) {
	p := testProvider(t)

	handler := p.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("next handler should not be called for tampered cookie")
	}))

	req := httptest.NewRequest("GET", "/api/instances", nil)
	req.AddCookie(&http.Cookie{Name: p.cfg.CookieName, Value: "tampered.garbage"})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
}

func TestMiddleware_AuthPathPassthrough(t *testing.T) {
	p := testProvider(t)
	var called bool

	handler := p.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	// No cookie, but path is /auth/... — should pass through.
	req := httptest.NewRequest("GET", "/auth/login", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("/auth/ path should pass through without cookie")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestSessionFromContext_NoSession(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	if s := SessionFromContext(req.Context()); s != nil {
		t.Errorf("expected nil session, got %+v", s)
	}
}
