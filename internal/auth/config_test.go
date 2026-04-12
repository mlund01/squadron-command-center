package auth

import (
	"encoding/hex"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// validHexSecret returns a hex-encoded 32-byte secret for use in tests.
func validHexSecret() string {
	return hex.EncodeToString(make([]byte, 32))
}

// setRequiredEnv sets all required OAuth env vars using t.Setenv-style GinkgoT().
func setRequiredEnv() {
	GinkgoT().Setenv("OAUTH_ISSUER_URL", "https://example.auth0.com/")
	GinkgoT().Setenv("OAUTH_CLIENT_ID", "my-client")
	GinkgoT().Setenv("OAUTH_CLIENT_SECRET", "my-secret")
	GinkgoT().Setenv("OAUTH_REDIRECT_URL", "http://localhost:8080/auth/callback")
	GinkgoT().Setenv("OAUTH_COOKIE_SECRET", validHexSecret())
}

var _ = Describe("Config", func() {
	Describe("LoadFromEnv", func() {
		Context("when no env vars are set", func() {
			It("returns nil config (disabled)", func() {
				cfg, err := LoadFromEnv()
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg).To(BeNil())
			})
		})

		Context("when fully configured", func() {
			BeforeEach(func() {
				GinkgoT().Setenv("OAUTH_ISSUER_URL", "https://example.auth0.com/")
				GinkgoT().Setenv("OAUTH_CLIENT_ID", "my-client")
				GinkgoT().Setenv("OAUTH_CLIENT_SECRET", "my-secret")
				GinkgoT().Setenv("OAUTH_REDIRECT_URL", "https://app.example.com/auth/callback")
				GinkgoT().Setenv("OAUTH_COOKIE_SECRET", validHexSecret())
			})

			It("returns a valid config", func() {
				cfg, err := LoadFromEnv()
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg).NotTo(BeNil())
				Expect(cfg.IssuerURL).To(Equal("https://example.auth0.com/"))
				Expect(cfg.ClientID).To(Equal("my-client"))
			})

			It("sets CookieSecure=true for https redirect URL", func() {
				cfg, err := LoadFromEnv()
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.CookieSecure).To(BeTrue())
			})

			It("uses default scopes", func() {
				cfg, err := LoadFromEnv()
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.Scopes).To(Equal([]string{"openid", "profile", "email"}))
			})

			It("uses default session TTL", func() {
				cfg, err := LoadFromEnv()
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.SessionTTL).To(Equal(defaultSessionTTL))
			})

			It("uses default cookie name", func() {
				cfg, err := LoadFromEnv()
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.CookieName).To(Equal(defaultCookieName))
			})
		})

		Context("when partially configured", func() {
			It("returns an error naming missing vars", func() {
				GinkgoT().Setenv("OAUTH_ISSUER_URL", "https://example.auth0.com/")
				// Everything else missing.

				cfg, err := LoadFromEnv()
				Expect(err).To(HaveOccurred())
				Expect(cfg).To(BeNil())
				Expect(err.Error()).To(ContainSubstring("OAUTH_CLIENT_ID"))
				Expect(err.Error()).To(ContainSubstring("OAUTH_CLIENT_SECRET"))
				Expect(err.Error()).To(ContainSubstring("OAUTH_REDIRECT_URL"))
				Expect(err.Error()).To(ContainSubstring("OAUTH_COOKIE_SECRET"))
			})
		})

		Context("when cookie secret is too short", func() {
			It("returns an error", func() {
				setRequiredEnv()
				GinkgoT().Setenv("OAUTH_COOKIE_SECRET", hex.EncodeToString(make([]byte, 16)))

				_, err := LoadFromEnv()
				Expect(err).To(MatchError(ContainSubstring("at least 32 bytes")))
			})
		})

		Context("when redirect URL is http", func() {
			It("sets CookieSecure=false", func() {
				setRequiredEnv()
				GinkgoT().Setenv("OAUTH_REDIRECT_URL", "http://localhost:8080/auth/callback")

				cfg, err := LoadFromEnv()
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.CookieSecure).To(BeFalse())
			})
		})

		Context("with custom scopes", func() {
			It("parses comma-separated scopes with whitespace", func() {
				setRequiredEnv()
				GinkgoT().Setenv("OAUTH_SCOPES", "openid, custom:read , custom:write")

				cfg, err := LoadFromEnv()
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.Scopes).To(Equal([]string{"openid", "custom:read", "custom:write"}))
			})
		})

		Context("with custom session TTL", func() {
			It("parses the duration", func() {
				setRequiredEnv()
				GinkgoT().Setenv("OAUTH_SESSION_TTL", "8h")

				cfg, err := LoadFromEnv()
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.SessionTTL).To(Equal(8 * time.Hour))
			})
		})

		Context("with allowed emails", func() {
			It("parses and lowercases the list", func() {
				setRequiredEnv()
				GinkgoT().Setenv("OAUTH_ALLOWED_EMAILS", "Alice@Example.com, bob@test.com")

				cfg, err := LoadFromEnv()
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.AllowedEmails).To(HaveLen(2))
				Expect(cfg.AllowedEmails).To(HaveKey("alice@example.com"))
				Expect(cfg.AllowedEmails).To(HaveKey("bob@test.com"))
			})
		})
	})

	Describe("EmailAllowed", func() {
		Context("with no allowlist", func() {
			It("allows everyone", func() {
				cfg := &Config{AllowedEmails: map[string]struct{}{}}
				Expect(cfg.EmailAllowed("anyone@example.com")).To(BeTrue())
			})
		})

		Context("with an allowlist", func() {
			var cfg *Config

			BeforeEach(func() {
				cfg = &Config{AllowedEmails: map[string]struct{}{
					"alice@example.com": {},
				}}
			})

			It("allows an exact match", func() {
				Expect(cfg.EmailAllowed("alice@example.com")).To(BeTrue())
			})

			It("allows case-insensitive match", func() {
				Expect(cfg.EmailAllowed("Alice@Example.COM")).To(BeTrue())
			})

			It("rejects non-listed email", func() {
				Expect(cfg.EmailAllowed("bob@example.com")).To(BeFalse())
			})
		})
	})
})
