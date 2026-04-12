package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Session is the user identity stored in the signed cookie. Keep fields
// minimal — anything here is visible to the browser (claims are base64 but
// not encrypted).
type Session struct {
	Sub     string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Expires int64  `json:"exp"`
}

// Expired reports whether the session has passed its expiry time.
func (s *Session) Expired() bool {
	return time.Now().Unix() >= s.Expires
}

// pendingState is the short-lived "OAuth flow in progress" payload: state,
// PKCE verifier, and post-login redirect target. Stored in its own cookie
// while the user is round-tripping through the IdP.
type pendingState struct {
	State    string `json:"s"`
	Verifier string `json:"v"`
	Next     string `json:"n"`
	Expires  int64  `json:"exp"`
}

// Expired reports whether the pending flow has timed out.
func (p *pendingState) Expired() bool {
	return time.Now().Unix() >= p.Expires
}

// encodeSigned produces a "<base64url(json)>.<base64url(hmac)>" cookie value.
func encodeSigned[T any](v T, secret []byte) (string, error) {
	payload, err := json.Marshal(v)
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	sig := mac.Sum(nil)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// decodeSigned verifies the HMAC and unmarshals. Does NOT check expiry.
func decodeSigned[T any](value string, secret []byte) (T, error) {
	var zero T
	dot := strings.IndexByte(value, '.')
	if dot < 0 {
		return zero, errors.New("invalid cookie format")
	}
	payloadB64, sigB64 := value[:dot], value[dot+1:]

	payload, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return zero, fmt.Errorf("decode payload: %w", err)
	}
	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return zero, fmt.Errorf("decode signature: %w", err)
	}

	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	expected := mac.Sum(nil)
	if !hmac.Equal(sig, expected) {
		return zero, errors.New("signature mismatch")
	}

	var out T
	if err := json.Unmarshal(payload, &out); err != nil {
		return zero, fmt.Errorf("unmarshal: %w", err)
	}
	return out, nil
}

// encodeSession is a typed convenience wrapper used by handlers.
func encodeSession(s Session, secret []byte) (string, error) {
	return encodeSigned(s, secret)
}

// decodeSession verifies the signature, unmarshals, and checks expiry.
func decodeSession(value string, secret []byte) (*Session, error) {
	s, err := decodeSigned[Session](value, secret)
	if err != nil {
		return nil, err
	}
	if s.Expired() {
		return nil, errors.New("session expired")
	}
	return &s, nil
}

func encodePending(p pendingState, secret []byte) (string, error) {
	return encodeSigned(p, secret)
}

func decodePending(value string, secret []byte) (*pendingState, error) {
	p, err := decodeSigned[pendingState](value, secret)
	if err != nil {
		return nil, err
	}
	if p.Expired() {
		return nil, errors.New("oauth flow expired")
	}
	return &p, nil
}
