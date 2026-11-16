package controlplane

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCredentialCipherRoundTrip(t *testing.T) {
	cipher, err := newCredentialCipher([]byte("01234567890123456789012345678901"))
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := cipher.Encrypt("worker-secret")
	if err != nil {
		t.Fatal(err)
	}
	if string(ciphertext) == "worker-secret" {
		t.Fatal("credential was stored as plaintext")
	}
	credential, err := cipher.Decrypt(ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if credential != "worker-secret" {
		t.Fatalf("credential = %q", credential)
	}
}

func TestVariableCipherBindsWorkspaceAndName(t *testing.T) {
	cipher, err := newVariableCipher([]byte("01234567890123456789012345678901"))
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := cipher.Encrypt("workspace-1", "api_key", "secret")
	if err != nil {
		t.Fatal(err)
	}
	value, err := cipher.Decrypt("workspace-1", "api_key", ciphertext)
	if err != nil || value != "secret" {
		t.Fatalf("decrypt = %q, %v", value, err)
	}
	if _, err := cipher.Decrypt("workspace-2", "api_key", ciphertext); err == nil {
		t.Fatal("ciphertext decrypted in a different workspace")
	}
	if _, err := cipher.Decrypt("workspace-1", "other", ciphertext); err == nil {
		t.Fatal("ciphertext decrypted under a different variable name")
	}
}

func TestModelConnectionCipherBindsWorkspaceAndName(t *testing.T) {
	cipher, err := newModelConnectionCipher(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := cipher.Encrypt("workspace-a", "anthropic", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if value, err := cipher.Decrypt("workspace-a", "anthropic", ciphertext); err != nil || value != "secret" {
		t.Fatalf("round trip failed: %q %v", value, err)
	}
	if _, err := cipher.Decrypt("workspace-b", "anthropic", ciphertext); err == nil {
		t.Fatal("credential decrypted in a different workspace")
	}
	if _, err := cipher.Decrypt("workspace-a", "openai", ciphertext); err == nil {
		t.Fatal("credential decrypted under a different connection name")
	}
}

func TestMCPConnectionCipherBindsCredentialToIdentityAndServer(t *testing.T) {
	cipher, err := newMCPConnectionCipher(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	const workspace, connection, kind, identity, resource = "workspace-a", "linear", "user", "user-1", "https://mcp.example/mcp"
	ciphertext, err := cipher.Encrypt(workspace, connection, kind, identity, resource, 1, []byte(`{"access_token":"secret"}`))
	if err != nil {
		t.Fatal(err)
	}
	if value, err := cipher.Decrypt(workspace, connection, kind, identity, resource, 1, ciphertext); err != nil || string(value) != `{"access_token":"secret"}` {
		t.Fatalf("round trip failed: %q %v", value, err)
	}
	for _, changed := range []struct {
		workspace, connection, kind, identity, resource string
		version                                         int
	}{
		{"workspace-b", connection, kind, identity, resource, 1},
		{workspace, "other", kind, identity, resource, 1},
		{workspace, connection, "service_principal", identity, resource, 1},
		{workspace, connection, kind, "user-2", resource, 1},
		{workspace, connection, kind, identity, "https://other.example/mcp", 1},
		{workspace, connection, kind, identity, resource, 2},
	} {
		if _, err := cipher.Decrypt(changed.workspace, changed.connection, changed.kind, changed.identity, changed.resource, changed.version, ciphertext); err == nil {
			t.Fatalf("credential decrypted with different binding: %+v", changed)
		}
	}
}

func TestMCPSecretMaterialDoesNotSerializeToAPIJSON(t *testing.T) {
	value, err := json.Marshal(MCPSecretMaterial{AccessToken: "access-secret", RefreshToken: "refresh-secret", ClientSecret: "client-secret", StaticHeaderValue: "static-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(value), "secret") {
		t.Fatalf("MCP secret material serialized: %s", value)
	}
}
