package auth

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Mode identifies which auth backend is configured.
type Mode int

const (
	ModeOIDC Mode = iota
	ModeBasic
)

// Config holds auth configuration loaded from the environment.
// A nil *Config (as returned by LoadFromEnv when unset) means authentication
// is disabled and the server should run without any login layer.
//
// Two mutually exclusive modes are supported:
//   - ModeOIDC: full OAuth/OIDC auth-code flow against an external IdP. This is
//     the recommended option for any real deployment — it delegates credential
//     handling to a hardened provider and supports SSO, MFA, revocation, etc.
//   - ModeBasic: a single hardcoded username + bcrypt password hash with an
//     in-memory brute-force limiter. Useful for quick personal deployments
//     where setting up an IdP would be overkill, but has no recovery, no MFA,
//     and the limiter state is lost on restart.
type Config struct {
	Mode Mode

	// OIDC fields (ModeOIDC only)
	IssuerURL    string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	Scopes       []string
	Audience     string

	// Basic-auth fields (ModeBasic only)
	BasicUsername     string
	BasicPasswordHash []byte

	// Shared
	CookieSecret  []byte
	CookieName    string
	CookieSecure  bool
	SessionTTL    time.Duration
	AllowedEmails map[string]struct{} // OIDC only
}

const defaultSessionTTL = 24 * time.Hour
const defaultCookieName = "commander_session"

// LoadFromEnv reads auth configuration from environment variables.
//
// Returns (nil, nil) when auth is disabled (neither OAUTH_ISSUER_URL nor
// BASIC_AUTH_USERNAME is set).
// Returns (*Config, nil) when fully configured for one of the two modes.
// Returns (nil, error) when partially configured, or when both modes are
// requested at once — we refuse to run in that state because the user
// probably expects auth to be on.
func LoadFromEnv() (*Config, error) {
	issuer := strings.TrimSpace(os.Getenv("OAUTH_ISSUER_URL"))
	basicUser := strings.TrimSpace(os.Getenv("BASIC_AUTH_USERNAME"))

	if issuer != "" && basicUser != "" {
		return nil, fmt.Errorf("OAUTH_ISSUER_URL and BASIC_AUTH_USERNAME are mutually exclusive — pick one auth mode")
	}
	if issuer == "" && basicUser == "" {
		return nil, nil
	}
	if basicUser != "" {
		return loadBasicFromEnv(basicUser)
	}

	clientID := os.Getenv("OAUTH_CLIENT_ID")
	clientSecret := os.Getenv("OAUTH_CLIENT_SECRET")
	redirectURL := os.Getenv("OAUTH_REDIRECT_URL")
	cookieSecretRaw := os.Getenv("OAUTH_COOKIE_SECRET")

	var missing []string
	if clientID == "" {
		missing = append(missing, "OAUTH_CLIENT_ID")
	}
	if clientSecret == "" {
		missing = append(missing, "OAUTH_CLIENT_SECRET")
	}
	if redirectURL == "" {
		missing = append(missing, "OAUTH_REDIRECT_URL")
	}
	if cookieSecretRaw == "" {
		missing = append(missing, "OAUTH_COOKIE_SECRET")
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("OAUTH_ISSUER_URL is set but these required variables are missing: %s", strings.Join(missing, ", "))
	}

	secret, err := decodeCookieSecret(cookieSecretRaw)
	if err != nil {
		return nil, fmt.Errorf("OAUTH_COOKIE_SECRET: %w", err)
	}
	if len(secret) < 32 {
		return nil, fmt.Errorf("OAUTH_COOKIE_SECRET must decode to at least 32 bytes, got %d", len(secret))
	}

	scopes := []string{"openid", "profile", "email"}
	if s := os.Getenv("OAUTH_SCOPES"); s != "" {
		scopes = splitAndTrim(s)
	}

	ttl := defaultSessionTTL
	if s := os.Getenv("OAUTH_SESSION_TTL"); s != "" {
		d, err := time.ParseDuration(s)
		if err != nil {
			return nil, fmt.Errorf("OAUTH_SESSION_TTL: %w", err)
		}
		ttl = d
	}

	cookieName := defaultCookieName
	if s := os.Getenv("OAUTH_COOKIE_NAME"); s != "" {
		cookieName = s
	}

	allowed := map[string]struct{}{}
	if s := os.Getenv("OAUTH_ALLOWED_EMAILS"); s != "" {
		for _, e := range splitAndTrim(s) {
			allowed[strings.ToLower(e)] = struct{}{}
		}
	}

	return &Config{
		Mode:          ModeOIDC,
		IssuerURL:     issuer,
		ClientID:      clientID,
		ClientSecret:  clientSecret,
		RedirectURL:   redirectURL,
		Scopes:        scopes,
		Audience:      os.Getenv("OAUTH_AUDIENCE"),
		CookieSecret:  secret,
		CookieName:    cookieName,
		CookieSecure:  strings.HasPrefix(redirectURL, "https://"),
		SessionTTL:    ttl,
		AllowedEmails: allowed,
	}, nil
}

// loadBasicFromEnv handles the BASIC_AUTH_* path of LoadFromEnv.
func loadBasicFromEnv(username string) (*Config, error) {
	hash := strings.TrimSpace(os.Getenv("BASIC_AUTH_PASSWORD_HASH"))
	cookieSecretRaw := os.Getenv("OAUTH_COOKIE_SECRET")

	var missing []string
	if hash == "" {
		missing = append(missing, "BASIC_AUTH_PASSWORD_HASH")
	}
	if cookieSecretRaw == "" {
		missing = append(missing, "OAUTH_COOKIE_SECRET")
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("BASIC_AUTH_USERNAME is set but these required variables are missing: %s", strings.Join(missing, ", "))
	}

	// Validate the hash at startup — otherwise a malformed value (e.g. a raw
	// plaintext password accidentally set) would silently fail every login
	// with no indication of the root cause.
	if _, err := bcrypt.Cost([]byte(hash)); err != nil {
		return nil, fmt.Errorf("BASIC_AUTH_PASSWORD_HASH: not a valid bcrypt hash: %w", err)
	}

	secret, err := decodeCookieSecret(cookieSecretRaw)
	if err != nil {
		return nil, fmt.Errorf("OAUTH_COOKIE_SECRET: %w", err)
	}
	if len(secret) < 32 {
		return nil, fmt.Errorf("OAUTH_COOKIE_SECRET must decode to at least 32 bytes, got %d", len(secret))
	}

	ttl := defaultSessionTTL
	if s := os.Getenv("OAUTH_SESSION_TTL"); s != "" {
		d, err := time.ParseDuration(s)
		if err != nil {
			return nil, fmt.Errorf("OAUTH_SESSION_TTL: %w", err)
		}
		ttl = d
	}

	cookieName := defaultCookieName
	if s := os.Getenv("OAUTH_COOKIE_NAME"); s != "" {
		cookieName = s
	}

	// CookieSecure: basic auth has no redirect URL to infer from. Default to
	// off, but let the operator force it on behind HTTPS-terminating proxies.
	cookieSecure := false
	if s := strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_COOKIE_SECURE"))); s == "1" || s == "true" {
		cookieSecure = true
	}

	return &Config{
		Mode:              ModeBasic,
		BasicUsername:     username,
		BasicPasswordHash: []byte(hash),
		CookieSecret:      secret,
		CookieName:        cookieName,
		CookieSecure:      cookieSecure,
		SessionTTL:        ttl,
	}, nil
}

// decodeCookieSecret accepts either hex or base64 (standard or url-safe).
func decodeCookieSecret(s string) ([]byte, error) {
	if b, err := hex.DecodeString(s); err == nil {
		return b, nil
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	if b, err := base64.URLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return nil, fmt.Errorf("value must be hex or base64 encoded")
}

func splitAndTrim(s string) []string {
	parts := strings.Split(s, ",")
	out := parts[:0]
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// EmailAllowed reports whether the given email is permitted to log in.
// If no allowlist is configured, every email is allowed.
func (c *Config) EmailAllowed(email string) bool {
	if len(c.AllowedEmails) == 0 {
		return true
	}
	_, ok := c.AllowedEmails[strings.ToLower(email)]
	return ok
}
