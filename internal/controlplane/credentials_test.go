package controlplane

import "testing"

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
