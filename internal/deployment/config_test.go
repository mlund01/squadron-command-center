package deployment

import (
	"encoding/hex"
	"testing"
)

func TestLoadFromEnvDefaultsToLegacy(t *testing.T) {
	t.Setenv("COMMAND_CENTER_MODE", "")
	t.Setenv("COMMAND_CENTER_PUBLIC_URL", "")
	t.Setenv("COMMAND_CENTER_DATABASE_URL", "")
	t.Setenv("COMMAND_CENTER_MASTER_KEY", "")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Mode != ModeLegacy {
		t.Fatalf("mode = %q, want %q", cfg.Mode, ModeLegacy)
	}
}

func TestLoadFromEnvControlPlaneRequiresAllValues(t *testing.T) {
	t.Setenv("COMMAND_CENTER_MODE", ModeControlPlane)

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected error")
	}
	if got := err.Error(); got != "control-plane mode requires: COMMAND_CENTER_PUBLIC_URL, COMMAND_CENTER_DATABASE_URL, COMMAND_CENTER_MASTER_KEY" {
		t.Fatalf("unexpected error: %s", got)
	}
}

func TestLoadFromEnvControlPlaneValidatesValues(t *testing.T) {
	t.Setenv("COMMAND_CENTER_MODE", ModeControlPlane)
	t.Setenv("COMMAND_CENTER_PUBLIC_URL", "https://command.example.com/")
	t.Setenv("COMMAND_CENTER_DATABASE_URL", "postgres://user:pass@db.example.com:5432/command_center?sslmode=require")
	t.Setenv("COMMAND_CENTER_MASTER_KEY", hex.EncodeToString(make([]byte, 32)))

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicURL != "https://command.example.com" {
		t.Fatalf("PublicURL = %q", cfg.PublicURL)
	}
	if len(cfg.MasterKey) != 32 {
		t.Fatalf("MasterKey length = %d", len(cfg.MasterKey))
	}
}

func TestLoadFromEnvRejectsNonPostgresDatabase(t *testing.T) {
	t.Setenv("COMMAND_CENTER_MODE", ModeControlPlane)
	t.Setenv("COMMAND_CENTER_PUBLIC_URL", "https://command.example.com")
	t.Setenv("COMMAND_CENTER_DATABASE_URL", "mysql://db.example.com/command_center")
	t.Setenv("COMMAND_CENTER_MASTER_KEY", hex.EncodeToString(make([]byte, 32)))

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected error")
	}
}
