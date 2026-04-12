package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

// testProviderWithOAuth builds a Provider with a fake oauth2.Config so that
// handleLogin can generate an authorize URL. No real IdP needed.
func testProviderWithOAuth(t *testing.T) *Provider {
	t.Helper()
	p := testProvider(t)
	p.oauth = &oauth2.Config{
		ClientID:    "test-client",
		RedirectURL: "http://localhost:8080/auth/callback",
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://idp.example.com/authorize",
			TokenURL: "https://idp.example.com/token",
		},
		Scopes: []string{"openid", "profile", "email"},
	}
	p.cfg.ClientID = "test-client"
	p.cfg.RedirectURL = "http://localhost:8080/auth/callback"
	return p
}

// --- handleLogin tests ---

func TestHandleLogin_Redirect(t *testing.T) {
	p := testProviderWithOAuth(t)

	req := httptest.NewRequest("GET", "/auth/login?next=/instances/abc/missions", nil)
	rec := httptest.NewRecorder()
	p.handleLogin(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	loc := rec.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("parse Location: %v", err)
	}
	if u.Host != "idp.example.com" || u.Path != "/authorize" {
		t.Errorf("redirect target = %s%s", u.Host, u.Path)
	}
	q := u.Query()
	if q.Get("client_id") != "test-client" {
		t.Errorf("client_id = %q", q.Get("client_id"))
	}
	if q.Get("code_challenge_method") != "S256" {
		t.Errorf("code_challenge_method = %q", q.Get("code_challenge_method"))
	}
	if q.Get("code_challenge") == "" {
		t.Error("missing code_challenge")
	}
	if q.Get("state") == "" {
		t.Error("missing state")
	}
}

func TestHandleLogin_SetsPendingCookie(t *testing.T) {
	p := testProviderWithOAuth(t)

	req := httptest.NewRequest("GET", "/auth/login?next=/foo", nil)
	rec := httptest.NewRecorder()
	p.handleLogin(rec, req)

	cookies := rec.Result().Cookies()
	var pending *http.Cookie
	for _, c := range cookies {
		if c.Name == pendingCookieName {
			pending = c
			break
		}
	}
	if pending == nil {
		t.Fatal("pending cookie not set")
	}
	if !pending.HttpOnly {
		t.Error("pending cookie should be HttpOnly")
	}

	// Decode and verify it contains the next path.
	ps, err := decodePending(pending.Value, p.cfg.CookieSecret)
	if err != nil {
		t.Fatalf("decode pending: %v", err)
	}
	if ps.Next != "/foo" {
		t.Errorf("pending.Next = %q, want /foo", ps.Next)
	}
	if ps.State == "" {
		t.Error("pending.State is empty")
	}
	if ps.Verifier == "" {
		t.Error("pending.Verifier is empty")
	}
}

func TestHandleLogin_UnsafeNextNormalized(t *testing.T) {
	p := testProviderWithOAuth(t)

	cases := []struct {
		next string
		want string
	}{
		{"", "/"},
		{"//evil.com", "/"},
		{"http://evil.com/foo", "/"},
		{"relative", "/"},
		{"/safe/path", "/safe/path"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest("GET", "/auth/login?next="+url.QueryEscape(tc.next), nil)
		rec := httptest.NewRecorder()
		p.handleLogin(rec, req)

		cookies := rec.Result().Cookies()
		var pending *http.Cookie
		for _, c := range cookies {
			if c.Name == pendingCookieName {
				pending = c
				break
			}
		}
		if pending == nil {
			t.Fatalf("next=%q: pending cookie not set", tc.next)
		}
		ps, err := decodePending(pending.Value, p.cfg.CookieSecret)
		if err != nil {
			t.Fatalf("next=%q: decode: %v", tc.next, err)
		}
		if ps.Next != tc.want {
			t.Errorf("next=%q: pending.Next = %q, want %q", tc.next, ps.Next, tc.want)
		}
	}
}

func TestHandleLogin_AudienceParam(t *testing.T) {
	p := testProviderWithOAuth(t)
	p.cfg.Audience = "https://api.example.com"

	req := httptest.NewRequest("GET", "/auth/login", nil)
	rec := httptest.NewRecorder()
	p.handleLogin(rec, req)

	loc := rec.Header().Get("Location")
	u, _ := url.Parse(loc)
	if u.Query().Get("audience") != "https://api.example.com" {
		t.Errorf("audience = %q", u.Query().Get("audience"))
	}
}

// --- handleLogout tests ---

func TestHandleLogout_ClearsCookie(t *testing.T) {
	p := testProviderWithOAuth(t)

	req := httptest.NewRequest("GET", "/auth/logout", nil)
	rec := httptest.NewRecorder()
	p.handleLogout(rec, req)

	cookies := rec.Result().Cookies()
	var sess *http.Cookie
	for _, c := range cookies {
		if c.Name == p.cfg.CookieName {
			sess = c
			break
		}
	}
	if sess == nil {
		t.Fatal("session cookie not in response")
	}
	if sess.MaxAge != -1 {
		t.Errorf("session cookie MaxAge = %d, want -1", sess.MaxAge)
	}
}

func TestHandleLogout_NoLogoutURL(t *testing.T) {
	p := testProviderWithOAuth(t)
	p.logoutURL = ""

	req := httptest.NewRequest("GET", "/auth/logout", nil)
	rec := httptest.NewRecorder()
	p.handleLogout(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/" {
		t.Errorf("Location = %q, want /", loc)
	}
}

func TestHandleLogout_WithLogoutURL(t *testing.T) {
	p := testProviderWithOAuth(t)
	p.logoutURL = "https://idp.example.com/logout"

	req := httptest.NewRequest("GET", "/auth/logout", nil)
	rec := httptest.NewRecorder()
	p.handleLogout(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	loc := rec.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("parse Location: %v", err)
	}
	if u.Host != "idp.example.com" || u.Path != "/logout" {
		t.Errorf("redirect = %s%s", u.Host, u.Path)
	}
	q := u.Query()
	if q.Get("client_id") != "test-client" {
		t.Errorf("client_id = %q", q.Get("client_id"))
	}
	if !strings.HasPrefix(q.Get("post_logout_redirect_uri"), "http://localhost:8080/") {
		t.Errorf("post_logout_redirect_uri = %q", q.Get("post_logout_redirect_uri"))
	}
}

// --- handleMe tests ---

func TestHandleMe_ValidSession(t *testing.T) {
	p := testProvider(t)

	req := httptest.NewRequest("GET", "/auth/me", nil)
	req.AddCookie(validSessionCookie(t, p))
	rec := httptest.NewRecorder()
	p.handleMe(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["email"] != "test@example.com" {
		t.Errorf("email = %q", body["email"])
	}
	if body["name"] != "Test User" {
		t.Errorf("name = %q", body["name"])
	}
}

func TestHandleMe_NoCookie(t *testing.T) {
	p := testProvider(t)

	req := httptest.NewRequest("GET", "/auth/me", nil)
	rec := httptest.NewRecorder()
	p.handleMe(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestHandleMe_ExpiredCookie(t *testing.T) {
	p := testProvider(t)

	sess := Session{
		Email:   "old@example.com",
		Expires: time.Now().Add(-time.Minute).Unix(),
	}
	val, _ := encodeSession(sess, p.cfg.CookieSecret)

	req := httptest.NewRequest("GET", "/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: p.cfg.CookieName, Value: val})
	rec := httptest.NewRecorder()
	p.handleMe(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

// --- helper tests ---

func TestBaseURL(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"https://app.example.com/auth/callback", "https://app.example.com/"},
		{"http://localhost:8080/auth/callback", "http://localhost:8080/"},
		{"not-a-url", ":///"},
	}
	for _, tc := range cases {
		got := baseURL(tc.in)
		if got != tc.want {
			t.Errorf("baseURL(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
