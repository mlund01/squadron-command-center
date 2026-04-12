package auth

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"
)

// Config holds OAuth/OIDC configuration loaded from the environment.
// A nil *Config (as returned by LoadFromEnv when unset) means authentication
// is disabled and the server should run without any login layer.
type Config struct {
	IssuerURL     string
	ClientID      string
	ClientSecret  string
	RedirectURL   string
	Scopes        []string
	Audience      string
	CookieSecret  []byte
	CookieName    string
	CookieSecure  bool
	SessionTTL    time.Duration
	AllowedEmails map[string]struct{}
}

const defaultSessionTTL = 24 * time.Hour
const defaultCookieName = "commander_session"

// LoadFromEnv reads OAuth configuration from environment variables.
//
// Returns (nil, nil) when OAuth is disabled (OAUTH_ISSUER_URL unset).
// Returns (*Config, nil) when fully configured.
// Returns (nil, error) when partially configured — we refuse to run in that
// state because the user probably expects auth to be on.
func LoadFromEnv() (*Config, error) {
	issuer := strings.TrimSpace(os.Getenv("OAUTH_ISSUER_URL"))
	if issuer == "" {
		return nil, nil
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
