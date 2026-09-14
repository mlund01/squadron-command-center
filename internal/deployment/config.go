// Package deployment owns the configuration required to run Command Center as
// a service. It intentionally uses environment variables: cloud providers can
// inject these directly and keep sensitive values in their own secret stores.
package deployment

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strings"
)

const (
	ModeLegacy       = "legacy"
	ModeControlPlane = "control-plane"
)

// Config is the server-owned deployment contract. DatabaseURL is validated
// here and will be consumed by the persistent control-plane store; keeping it
// in this boundary prevents future worker configuration from leaking into the
// server deployment contract.
type Config struct {
	Mode        string
	PublicURL   string
	DatabaseURL string
	MasterKey   []byte
	SetupToken  string
}

// LoadFromEnv loads deployment configuration. Legacy mode preserves the
// current self-contained dashboard behavior. Control-plane mode is explicit
// and rejects incomplete production configuration at startup.
func LoadFromEnv() (*Config, error) {
	mode := strings.TrimSpace(os.Getenv("COMMAND_CENTER_MODE"))
	if mode == "" {
		mode = ModeLegacy
	}
	if mode != ModeLegacy && mode != ModeControlPlane {
		return nil, fmt.Errorf("COMMAND_CENTER_MODE must be %q or %q", ModeLegacy, ModeControlPlane)
	}

	cfg := &Config{
		Mode:        mode,
		PublicURL:   strings.TrimRight(strings.TrimSpace(os.Getenv("COMMAND_CENTER_PUBLIC_URL")), "/"),
		DatabaseURL: strings.TrimSpace(os.Getenv("COMMAND_CENTER_DATABASE_URL")),
		SetupToken:  strings.TrimSpace(os.Getenv("COMMAND_CENTER_SETUP_TOKEN")),
	}

	if cfg.PublicURL != "" {
		if err := validateHTTPURL("COMMAND_CENTER_PUBLIC_URL", cfg.PublicURL); err != nil {
			return nil, err
		}
	}

	if mode == ModeLegacy {
		return cfg, nil
	}

	var missing []string
	if cfg.PublicURL == "" {
		missing = append(missing, "COMMAND_CENTER_PUBLIC_URL")
	}
	if cfg.DatabaseURL == "" {
		missing = append(missing, "COMMAND_CENTER_DATABASE_URL")
	}
	masterKey := strings.TrimSpace(os.Getenv("COMMAND_CENTER_MASTER_KEY"))
	if masterKey == "" {
		missing = append(missing, "COMMAND_CENTER_MASTER_KEY")
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("control-plane mode requires: %s", strings.Join(missing, ", "))
	}
	if err := validatePostgresURL(cfg.DatabaseURL); err != nil {
		return nil, err
	}

	key, err := decodeSecret(masterKey)
	if err != nil {
		return nil, fmt.Errorf("COMMAND_CENTER_MASTER_KEY: %w", err)
	}
	if len(key) < 32 {
		return nil, fmt.Errorf("COMMAND_CENTER_MASTER_KEY must decode to at least 32 bytes")
	}
	cfg.MasterKey = key
	return cfg, nil
}

func validateHTTPURL(name, rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme == "" || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("%s must be an absolute http(s) URL", name)
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("%s must not include a query string or fragment", name)
	}
	return nil
}

func validatePostgresURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" || strings.Trim(u.Path, "/") == "" {
		return fmt.Errorf("COMMAND_CENTER_DATABASE_URL must be a PostgreSQL connection URL")
	}
	return nil
}

func decodeSecret(value string) ([]byte, error) {
	if decoded, err := hex.DecodeString(value); err == nil {
		return decoded, nil
	}
	if decoded, err := base64.StdEncoding.DecodeString(value); err == nil {
		return decoded, nil
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(value); err == nil {
		return decoded, nil
	}
	return nil, fmt.Errorf("must be hex or base64 encoded")
}
