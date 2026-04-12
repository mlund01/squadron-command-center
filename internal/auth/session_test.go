package auth

import (
	"strings"
	"testing"
	"time"
)

var testSecret = []byte("0123456789abcdef0123456789abcdef")

func TestSessionRoundTrip(t *testing.T) {
	s := Session{
		Sub:     "user-42",
		Email:   "alice@example.com",
		Name:    "Alice",
		Expires: time.Now().Add(1 * time.Hour).Unix(),
	}
	enc, err := encodeSession(s, testSecret)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := decodeSession(enc, testSecret)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Sub != s.Sub || got.Email != s.Email || got.Name != s.Name {
		t.Errorf("decoded session mismatch: got %+v want %+v", got, s)
	}
}

func TestSessionTamperedPayloadFailsHMAC(t *testing.T) {
	s := Session{Email: "a@b.c", Expires: time.Now().Add(time.Hour).Unix()}
	enc, err := encodeSession(s, testSecret)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	// Flip a byte in the payload portion (before the dot).
	dot := strings.IndexByte(enc, '.')
	if dot < 2 {
		t.Fatalf("unexpected encoded format")
	}
	tampered := enc[:dot-1] + flipASCII(enc[dot-1:dot]) + enc[dot:]
	if _, err := decodeSession(tampered, testSecret); err == nil {
		t.Errorf("expected error for tampered payload, got nil")
	}
}

func TestSessionWrongSecretFails(t *testing.T) {
	s := Session{Email: "a@b.c", Expires: time.Now().Add(time.Hour).Unix()}
	enc, err := encodeSession(s, testSecret)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	otherSecret := []byte("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX")
	if _, err := decodeSession(enc, otherSecret); err == nil {
		t.Errorf("expected error for wrong secret, got nil")
	}
}

func TestSessionExpiredRejected(t *testing.T) {
	s := Session{Email: "a@b.c", Expires: time.Now().Add(-1 * time.Minute).Unix()}
	enc, err := encodeSession(s, testSecret)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if _, err := decodeSession(enc, testSecret); err == nil {
		t.Errorf("expected error for expired session, got nil")
	}
}

func TestSessionInvalidFormat(t *testing.T) {
	cases := []string{
		"",
		"no-dot-separator",
		".",
		"onlypayload.",
		".onlysig",
	}
	for _, c := range cases {
		if _, err := decodeSession(c, testSecret); err == nil {
			t.Errorf("expected error for %q, got nil", c)
		}
	}
}

func flipASCII(s string) string {
	if len(s) == 0 {
		return s
	}
	b := []byte(s)
	if b[0] == 'A' {
		b[0] = 'B'
	} else {
		b[0] = 'A'
	}
	return string(b)
}
