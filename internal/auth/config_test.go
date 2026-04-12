package auth

import (
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

func TestLoadFromEnv_Disabled(t *testing.T) {
	// No env vars set → disabled, no error.
	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg != nil {
		t.Fatalf("expected nil config when disabled, got %+v", cfg)
	}
}

func TestLoadFromEnv_FullConfig(t *testing.T) {
	secret := hex.EncodeToString(make([]byte, 32))
	t.Setenv("OAUTH_ISSUER_URL", "https://example.auth0.com/")
	t.Setenv("OAUTH_CLIENT_ID", "my-client")
	t.Setenv("OAUTH_CLIENT_SECRET", "my-secret")
	t.Setenv("OAUTH_REDIRECT_URL", "https://app.example.com/auth/callback")
	t.Setenv("OAUTH_COOKIE_SECRET", secret)

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg == nil {
		t.Fatal("expected non-nil config")
	}
	if cfg.IssuerURL != "https://example.auth0.com/" {
		t.Errorf("IssuerURL = %q", cfg.IssuerURL)
	}
	if cfg.ClientID != "my-client" {
		t.Errorf("ClientID = %q", cfg.ClientID)
	}
	if !cfg.CookieSecure {
		t.Error("expected CookieSecure=true for https redirect URL")
	}
	if cfg.CookieName != defaultCookieName {
		t.Errorf("CookieName = %q, want %q", cfg.CookieName, defaultCookieName)
	}
	if cfg.SessionTTL != defaultSessionTTL {
		t.Errorf("SessionTTL = %v, want %v", cfg.SessionTTL, defaultSessionTTL)
	}
	// Default scopes
	if len(cfg.Scopes) != 3 || cfg.Scopes[0] != "openid" {
		t.Errorf("Scopes = %v", cfg.Scopes)
	}
}

func TestLoadFromEnv_PartialConfig(t *testing.T) {
	t.Setenv("OAUTH_ISSUER_URL", "https://example.auth0.com/")
	// Missing all other required vars.

	cfg, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected error for partial config")
	}
	if cfg != nil {
		t.Fatal("expected nil config on error")
	}
	for _, name := range []string{"OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "OAUTH_REDIRECT_URL", "OAUTH_COOKIE_SECRET"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error %q should mention %s", err, name)
		}
	}
}

func TestLoadFromEnv_CookieSecretTooShort(t *testing.T) {
	t.Setenv("OAUTH_ISSUER_URL", "https://example.auth0.com/")
	t.Setenv("OAUTH_CLIENT_ID", "c")
	t.Setenv("OAUTH_CLIENT_SECRET", "s")
	t.Setenv("OAUTH_REDIRECT_URL", "http://localhost/cb")
	t.Setenv("OAUTH_COOKIE_SECRET", hex.EncodeToString(make([]byte, 16))) // 16 bytes, need 32

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected error for short secret")
	}
	if !strings.Contains(err.Error(), "at least 32 bytes") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestLoadFromEnv_HTTPRedirectNotSecure(t *testing.T) {
	secret := hex.EncodeToString(make([]byte, 32))
	t.Setenv("OAUTH_ISSUER_URL", "https://example.auth0.com/")
	t.Setenv("OAUTH_CLIENT_ID", "c")
	t.Setenv("OAUTH_CLIENT_SECRET", "s")
	t.Setenv("OAUTH_REDIRECT_URL", "http://localhost:8080/auth/callback")
	t.Setenv("OAUTH_COOKIE_SECRET", secret)

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.CookieSecure {
		t.Error("expected CookieSecure=false for http redirect URL")
	}
}

func TestLoadFromEnv_CustomScopes(t *testing.T) {
	secret := hex.EncodeToString(make([]byte, 32))
	t.Setenv("OAUTH_ISSUER_URL", "https://example.auth0.com/")
	t.Setenv("OAUTH_CLIENT_ID", "c")
	t.Setenv("OAUTH_CLIENT_SECRET", "s")
	t.Setenv("OAUTH_REDIRECT_URL", "http://localhost/cb")
	t.Setenv("OAUTH_COOKIE_SECRET", secret)
	t.Setenv("OAUTH_SCOPES", "openid, custom:read , custom:write")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{"openid", "custom:read", "custom:write"}
	if len(cfg.Scopes) != len(want) {
		t.Fatalf("Scopes = %v, want %v", cfg.Scopes, want)
	}
	for i, s := range want {
		if cfg.Scopes[i] != s {
			t.Errorf("Scopes[%d] = %q, want %q", i, cfg.Scopes[i], s)
		}
	}
}

func TestLoadFromEnv_CustomSessionTTL(t *testing.T) {
	secret := hex.EncodeToString(make([]byte, 32))
	t.Setenv("OAUTH_ISSUER_URL", "https://example.auth0.com/")
	t.Setenv("OAUTH_CLIENT_ID", "c")
	t.Setenv("OAUTH_CLIENT_SECRET", "s")
	t.Setenv("OAUTH_REDIRECT_URL", "http://localhost/cb")
	t.Setenv("OAUTH_COOKIE_SECRET", secret)
	t.Setenv("OAUTH_SESSION_TTL", "8h")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.SessionTTL != 8*time.Hour {
		t.Errorf("SessionTTL = %v, want 8h", cfg.SessionTTL)
	}
}

func TestLoadFromEnv_AllowedEmails(t *testing.T) {
	secret := hex.EncodeToString(make([]byte, 32))
	t.Setenv("OAUTH_ISSUER_URL", "https://example.auth0.com/")
	t.Setenv("OAUTH_CLIENT_ID", "c")
	t.Setenv("OAUTH_CLIENT_SECRET", "s")
	t.Setenv("OAUTH_REDIRECT_URL", "http://localhost/cb")
	t.Setenv("OAUTH_COOKIE_SECRET", secret)
	t.Setenv("OAUTH_ALLOWED_EMAILS", "Alice@Example.com, bob@test.com")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.AllowedEmails) != 2 {
		t.Fatalf("AllowedEmails has %d entries, want 2", len(cfg.AllowedEmails))
	}
	// Should be lowercased
	if _, ok := cfg.AllowedEmails["alice@example.com"]; !ok {
		t.Error("missing alice@example.com (should be lowercased)")
	}
}

func TestEmailAllowed_NoAllowlist(t *testing.T) {
	cfg := &Config{AllowedEmails: map[string]struct{}{}}
	if !cfg.EmailAllowed("anyone@example.com") {
		t.Error("empty allowlist should allow everyone")
	}
}

func TestEmailAllowed_WithAllowlist(t *testing.T) {
	cfg := &Config{AllowedEmails: map[string]struct{}{
		"alice@example.com": {},
	}}
	if !cfg.EmailAllowed("alice@example.com") {
		t.Error("exact match should be allowed")
	}
	if !cfg.EmailAllowed("Alice@Example.COM") {
		t.Error("case-insensitive match should be allowed")
	}
	if cfg.EmailAllowed("bob@example.com") {
		t.Error("non-listed email should be rejected")
	}
}
