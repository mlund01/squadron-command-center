package controlplane

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestMCPOAuthAttemptCipherBindsClientStateToAttempt(t *testing.T) {
	cipher, err := newMCPOAuthAttemptCipher(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	secret := []byte(`{"client_secret":"secret","verifier":"verifier"}`)
	ciphertext, err := cipher.Encrypt("attempt-1", secret)
	if err != nil {
		t.Fatal(err)
	}
	if string(ciphertext) == string(secret) {
		t.Fatal("OAuth client state stored as plaintext")
	}
	value, err := cipher.Decrypt("attempt-1", ciphertext)
	if err != nil || string(value) != string(secret) {
		t.Fatalf("round trip = %s, %v", value, err)
	}
	if _, err := cipher.Decrypt("attempt-2", ciphertext); err == nil {
		t.Fatal("OAuth client state decrypted under another attempt")
	}
}

func TestMCPOAuthIssuerValidation(t *testing.T) {
	const issuer = "https://auth.example/tenant"
	for _, test := range []struct {
		actual   string
		required bool
		want     bool
	}{
		{issuer, true, true},
		{issuer, false, true},
		{"", true, false},
		{"", false, true},
		{"https://other.example/tenant", true, false},
		{"https://other.example/tenant", false, false},
		{"https://AUTH.example/tenant", false, false},
	} {
		if got := validMCPOAuthIssuer(issuer, test.actual, test.required); got != test.want {
			t.Errorf("issuer %q required %t: got %t, want %t", test.actual, test.required, got, test.want)
		}
	}
}

func TestMCPOAuthAttemptSecretsStayOutOfJSON(t *testing.T) {
	item := ConsumedMCPOAuthAttempt{MCPOAuthAttempt: MCPOAuthAttempt{ClientID: "secret-client-id", ClientSecret: "secret-client-value"}, CodeVerifier: "secret-verifier"}
	encoded, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret-") {
		t.Fatalf("OAuth attempt secret serialized: %s", encoded)
	}
}

func TestMCPOAuthStateHasCryptographicSize(t *testing.T) {
	first, err := randomMCPOAuthSecret()
	if err != nil {
		t.Fatal(err)
	}
	second, err := randomMCPOAuthSecret()
	if err != nil {
		t.Fatal(err)
	}
	value, err := base64.RawURLEncoding.DecodeString(first)
	if err != nil || len(value) != 32 || first == second {
		t.Fatalf("OAuth states did not contain independent 32-byte values: %v", err)
	}
}
