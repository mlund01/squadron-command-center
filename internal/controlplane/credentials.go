package controlplane

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"
)

// credentialCipher encrypts recoverable worker credentials with a key derived
// from the deployment master key. The database stores only nonce+ciphertext.
type credentialCipher struct {
	aead cipher.AEAD
}

type variableCipher struct {
	aead cipher.AEAD
}

type modelConnectionCipher struct {
	aead cipher.AEAD
}

func newCredentialCipher(masterKey []byte) (*credentialCipher, error) {
	if len(masterKey) < 32 {
		return nil, fmt.Errorf("credential encryption key must be at least 32 bytes")
	}
	derived := sha256.Sum256(append([]byte("command-center/worker-credential/v1:"), masterKey...))
	block, err := aes.NewCipher(derived[:])
	if err != nil {
		return nil, fmt.Errorf("create credential cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create credential cipher mode: %w", err)
	}
	return &credentialCipher{aead: aead}, nil
}

func newVariableCipher(masterKey []byte) (*variableCipher, error) {
	if len(masterKey) < 32 {
		return nil, fmt.Errorf("variable encryption key must be at least 32 bytes")
	}
	derived := sha256.Sum256(append([]byte("command-center/workspace-variable/v1:"), masterKey...))
	block, err := aes.NewCipher(derived[:])
	if err != nil {
		return nil, fmt.Errorf("create variable cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create variable cipher mode: %w", err)
	}
	return &variableCipher{aead: aead}, nil
}

func newModelConnectionCipher(masterKey []byte) (*modelConnectionCipher, error) {
	if len(masterKey) < 32 {
		return nil, fmt.Errorf("model connection encryption key must be at least 32 bytes")
	}
	derived := sha256.Sum256(append([]byte("command-center/model-connection/v1:"), masterKey...))
	block, err := aes.NewCipher(derived[:])
	if err != nil {
		return nil, fmt.Errorf("create model connection cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create model connection cipher mode: %w", err)
	}
	return &modelConnectionCipher{aead: aead}, nil
}

func (c *credentialCipher) Encrypt(credential string) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate credential nonce: %w", err)
	}
	return c.aead.Seal(nonce, nonce, []byte(credential), nil), nil
}

func (c *credentialCipher) Decrypt(ciphertext []byte) (string, error) {
	if len(ciphertext) < c.aead.NonceSize() {
		return "", fmt.Errorf("invalid encrypted worker credential")
	}
	nonce := ciphertext[:c.aead.NonceSize()]
	plaintext, err := c.aead.Open(nil, nonce, ciphertext[c.aead.NonceSize():], nil)
	if err != nil {
		return "", fmt.Errorf("decrypt worker credential: %w", err)
	}
	return string(plaintext), nil
}

func (c *variableCipher) Encrypt(workspaceID, name, value string) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate variable nonce: %w", err)
	}
	return c.aead.Seal(nonce, nonce, []byte(value), []byte(workspaceID+"\x00"+name)), nil
}

func (c *variableCipher) Decrypt(workspaceID, name string, ciphertext []byte) (string, error) {
	if len(ciphertext) < c.aead.NonceSize() {
		return "", fmt.Errorf("invalid encrypted workspace variable")
	}
	nonce := ciphertext[:c.aead.NonceSize()]
	plaintext, err := c.aead.Open(nil, nonce, ciphertext[c.aead.NonceSize():], []byte(workspaceID+"\x00"+name))
	if err != nil {
		return "", fmt.Errorf("decrypt workspace variable: %w", err)
	}
	return string(plaintext), nil
}

func (c *modelConnectionCipher) Encrypt(workspaceID, name, value string) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate model connection nonce: %w", err)
	}
	return c.aead.Seal(nonce, nonce, []byte(value), []byte(workspaceID+"\x00"+name)), nil
}

func (c *modelConnectionCipher) Decrypt(workspaceID, name string, ciphertext []byte) (string, error) {
	if len(ciphertext) < c.aead.NonceSize() {
		return "", fmt.Errorf("invalid encrypted model connection credential")
	}
	nonce := ciphertext[:c.aead.NonceSize()]
	plaintext, err := c.aead.Open(nil, nonce, ciphertext[c.aead.NonceSize():], []byte(workspaceID+"\x00"+name))
	if err != nil {
		return "", fmt.Errorf("decrypt model connection credential: %w", err)
	}
	return string(plaintext), nil
}
