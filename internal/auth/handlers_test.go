package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"golang.org/x/oauth2"
)

func testProviderWithOAuth() *Provider {
	p := testProvider()
	p.oauth = &oauth2.Config{
		ClientID:    "test-client",
		RedirectURL: "http://localhost:8080/auth/callback",
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://idp.example.com/authorize",
			TokenURL: "https://idp.example.com/token",
		},
		Scopes: []string{"openid", "profile", "email"},
	}
	p.cfg.ClientID = "test-client"
	p.cfg.RedirectURL = "http://localhost:8080/auth/callback"
	return p
}

var _ = Describe("Handlers", func() {

	Describe("handleLogin", func() {
		var p *Provider

		BeforeEach(func() {
			p = testProviderWithOAuth()
		})

		It("redirects to the IdP authorize endpoint", func() {
			req := httptest.NewRequest("GET", "/auth/login?next=/instances/abc", nil)
			rec := httptest.NewRecorder()
			p.handleLogin(rec, req)

			Expect(rec.Code).To(Equal(http.StatusFound))
			u, err := url.Parse(rec.Header().Get("Location"))
			Expect(err).NotTo(HaveOccurred())
			Expect(u.Host).To(Equal("idp.example.com"))
			Expect(u.Path).To(Equal("/authorize"))

			q := u.Query()
			Expect(q.Get("client_id")).To(Equal("test-client"))
			Expect(q.Get("code_challenge_method")).To(Equal("S256"))
			Expect(q.Get("code_challenge")).NotTo(BeEmpty())
			Expect(q.Get("state")).NotTo(BeEmpty())
		})

		It("sets the pending cookie with the next path", func() {
			req := httptest.NewRequest("GET", "/auth/login?next=/foo", nil)
			rec := httptest.NewRecorder()
			p.handleLogin(rec, req)

			var pending *http.Cookie
			for _, c := range rec.Result().Cookies() {
				if c.Name == pendingCookieName {
					pending = c
				}
			}
			Expect(pending).NotTo(BeNil())
			Expect(pending.HttpOnly).To(BeTrue())

			ps, err := decodePending(pending.Value, p.cfg.CookieSecret)
			Expect(err).NotTo(HaveOccurred())
			Expect(ps.Next).To(Equal("/foo"))
			Expect(ps.State).NotTo(BeEmpty())
			Expect(ps.Verifier).NotTo(BeEmpty())
		})

		DescribeTable("normalizes unsafe next values to /",
			func(next string) {
				req := httptest.NewRequest("GET", "/auth/login?next="+url.QueryEscape(next), nil)
				rec := httptest.NewRecorder()
				p.handleLogin(rec, req)

				var pending *http.Cookie
				for _, c := range rec.Result().Cookies() {
					if c.Name == pendingCookieName {
						pending = c
					}
				}
				Expect(pending).NotTo(BeNil())
				ps, err := decodePending(pending.Value, p.cfg.CookieSecret)
				Expect(err).NotTo(HaveOccurred())
				Expect(ps.Next).To(Equal("/"))
			},
			Entry("empty string", ""),
			Entry("protocol-relative URL", "//evil.com"),
			Entry("absolute URL", "http://evil.com/foo"),
			Entry("relative path (no leading /)", "relative"),
		)

		It("includes audience param when configured", func() {
			p.cfg.Audience = "https://api.example.com"

			req := httptest.NewRequest("GET", "/auth/login", nil)
			rec := httptest.NewRecorder()
			p.handleLogin(rec, req)

			u, _ := url.Parse(rec.Header().Get("Location"))
			Expect(u.Query().Get("audience")).To(Equal("https://api.example.com"))
		})
	})

	Describe("handleLogout", func() {
		It("clears the session cookie", func() {
			p := testProviderWithOAuth()

			req := httptest.NewRequest("GET", "/auth/logout", nil)
			rec := httptest.NewRecorder()
			p.handleLogout(rec, req)

			var sess *http.Cookie
			for _, c := range rec.Result().Cookies() {
				if c.Name == p.cfg.CookieName {
					sess = c
				}
			}
			Expect(sess).NotTo(BeNil())
			Expect(sess.MaxAge).To(Equal(-1))
		})

		Context("without end_session_endpoint", func() {
			It("redirects to /", func() {
				p := testProviderWithOAuth()
				p.logoutURL = ""

				req := httptest.NewRequest("GET", "/auth/logout", nil)
				rec := httptest.NewRecorder()
				p.handleLogout(rec, req)

				Expect(rec.Code).To(Equal(http.StatusFound))
				Expect(rec.Header().Get("Location")).To(Equal("/"))
			})
		})

		Context("with end_session_endpoint", func() {
			It("redirects to the IdP logout URL with correct params", func() {
				p := testProviderWithOAuth()
				p.logoutURL = "https://idp.example.com/logout"

				req := httptest.NewRequest("GET", "/auth/logout", nil)
				rec := httptest.NewRecorder()
				p.handleLogout(rec, req)

				Expect(rec.Code).To(Equal(http.StatusFound))
				u, err := url.Parse(rec.Header().Get("Location"))
				Expect(err).NotTo(HaveOccurred())
				Expect(u.Host).To(Equal("idp.example.com"))
				Expect(u.Path).To(Equal("/logout"))
				Expect(u.Query().Get("client_id")).To(Equal("test-client"))
				Expect(u.Query().Get("post_logout_redirect_uri")).To(
					HavePrefix("http://localhost:8080/"),
				)
			})
		})
	})

	Describe("handleMe", func() {
		It("returns user info for a valid session", func() {
			p := testProvider()
			req := httptest.NewRequest("GET", "/auth/me", nil)
			req.AddCookie(validSessionCookie(p))
			rec := httptest.NewRecorder()
			p.handleMe(rec, req)

			Expect(rec.Code).To(Equal(http.StatusOK))
			var body map[string]string
			Expect(json.NewDecoder(rec.Body).Decode(&body)).To(Succeed())
			Expect(body["email"]).To(Equal("test@example.com"))
			Expect(body["name"]).To(Equal("Test User"))
		})

		It("returns 401 with no cookie", func() {
			p := testProvider()
			req := httptest.NewRequest("GET", "/auth/me", nil)
			rec := httptest.NewRecorder()
			p.handleMe(rec, req)

			Expect(rec.Code).To(Equal(http.StatusUnauthorized))
		})

		It("returns 401 with an expired cookie", func() {
			p := testProvider()
			sess := Session{
				Email:   "old@example.com",
				Expires: time.Now().Add(-time.Minute).Unix(),
			}
			val, err := encodeSession(sess, p.cfg.CookieSecret)
			Expect(err).NotTo(HaveOccurred())

			req := httptest.NewRequest("GET", "/auth/me", nil)
			req.AddCookie(&http.Cookie{Name: p.cfg.CookieName, Value: val})
			rec := httptest.NewRecorder()
			p.handleMe(rec, req)

			Expect(rec.Code).To(Equal(http.StatusUnauthorized))
		})
	})

	Describe("baseURL", func() {
		DescribeTable("extracts scheme://host",
			func(input, expected string) {
				Expect(baseURL(input)).To(Equal(expected))
			},
			Entry("https URL", "https://app.example.com/auth/callback", "https://app.example.com/"),
			Entry("http with port", "http://localhost:8080/auth/callback", "http://localhost:8080/"),
		)
	})

	Describe("handleCallback", func() {
		It("returns 400 when IdP reports an error", func() {
			p := testProviderWithOAuth()
			req := httptest.NewRequest("GET", "/auth/callback?error=access_denied&error_description=user+denied", nil)
			rec := httptest.NewRecorder()
			p.handleCallback(rec, req)

			Expect(rec.Code).To(Equal(http.StatusBadRequest))
			Expect(rec.Body.String()).To(ContainSubstring("access_denied"))
		})

		It("returns 400 when pending cookie is missing", func() {
			p := testProviderWithOAuth()
			req := httptest.NewRequest("GET", "/auth/callback?code=abc&state=xyz", nil)
			rec := httptest.NewRecorder()
			p.handleCallback(rec, req)

			Expect(rec.Code).To(Equal(http.StatusBadRequest))
			Expect(rec.Body.String()).To(ContainSubstring("missing oauth flow cookie"))
		})

		It("returns 400 when state doesn't match", func() {
			p := testProviderWithOAuth()

			ps := pendingState{
				State:    "correct-state",
				Verifier: "verifier",
				Next:     "/",
				Expires:  time.Now().Add(5 * time.Minute).Unix(),
			}
			val, err := encodePending(ps, p.cfg.CookieSecret)
			Expect(err).NotTo(HaveOccurred())

			req := httptest.NewRequest("GET", "/auth/callback?code=abc&state=wrong-state", nil)
			req.AddCookie(&http.Cookie{Name: pendingCookieName, Value: val})
			rec := httptest.NewRecorder()
			p.handleCallback(rec, req)

			Expect(rec.Code).To(Equal(http.StatusBadRequest))
			Expect(rec.Body.String()).To(ContainSubstring("state mismatch"))
		})

		It("clears the pending cookie on callback", func() {
			p := testProviderWithOAuth()

			ps := pendingState{
				State:    "mystate",
				Verifier: "myverifier",
				Next:     "/",
				Expires:  time.Now().Add(5 * time.Minute).Unix(),
			}
			val, err := encodePending(ps, p.cfg.CookieSecret)
			Expect(err).NotTo(HaveOccurred())

			req := httptest.NewRequest("GET", "/auth/callback?code=abc&state=mystate", nil)
			req.AddCookie(&http.Cookie{Name: pendingCookieName, Value: val})
			rec := httptest.NewRecorder()
			p.handleCallback(rec, req)

			// Even though the token exchange will fail (no real IdP), the
			// pending cookie should still be cleared.
			var cleared *http.Cookie
			for _, c := range rec.Result().Cookies() {
				if c.Name == pendingCookieName {
					cleared = c
				}
			}
			Expect(cleared).NotTo(BeNil())
			Expect(cleared.MaxAge).To(Equal(-1))
		})
	})

	Describe("handleCallback error on IdP error query param", func() {
		It("surfaces error_description", func() {
			p := testProviderWithOAuth()
			req := httptest.NewRequest("GET",
				"/auth/callback?error=server_error&error_description=something+broke",
				nil,
			)
			rec := httptest.NewRecorder()
			p.handleCallback(rec, req)

			Expect(rec.Code).To(Equal(http.StatusBadRequest))
			body := rec.Body.String()
			Expect(body).To(ContainSubstring("server_error"))
			Expect(body).To(ContainSubstring("something broke"))
		})
	})
})

// Silence the "strings imported and not used" lint when not needed.
var _ = strings.HasPrefix
