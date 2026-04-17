package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"golang.org/x/crypto/bcrypt"
)

func testBasicProvider(username, password string) *Provider {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	Expect(err).NotTo(HaveOccurred())
	return &Provider{
		cfg: &Config{
			Mode:              ModeBasic,
			BasicUsername:     username,
			BasicPasswordHash: hash,
			CookieSecret:      make([]byte, 32),
			CookieName:        defaultCookieName,
			SessionTTL:        defaultSessionTTL,
		},
		limiter: newBruteForceLimiter(),
	}
}

// loginAttempt mimics what a browser would do: GET /auth/login to pick up a
// CSRF token + cookie, then POST the form back with both. remoteAddr lets
// tests control the limiter key.
func loginAttempt(p *Provider, username, password, remoteAddr string) *httptest.ResponseRecorder {
	getReq := httptest.NewRequest("GET", "/auth/login", nil)
	getReq.RemoteAddr = remoteAddr
	getRec := httptest.NewRecorder()
	p.handleLogin(getRec, getReq)

	var csrfCookie *http.Cookie
	for _, c := range getRec.Result().Cookies() {
		if c.Name == csrfCookieName {
			csrfCookie = c
		}
	}
	Expect(csrfCookie).NotTo(BeNil(), "GET should issue CSRF cookie")

	form := url.Values{
		"username": {username},
		"password": {password},
		"csrf":     {csrfCookie.Value},
	}
	postReq := httptest.NewRequest("POST", "/auth/login", strings.NewReader(form.Encode()))
	postReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	postReq.AddCookie(csrfCookie)
	postReq.RemoteAddr = remoteAddr
	postRec := httptest.NewRecorder()
	p.handleLogin(postRec, postReq)
	return postRec
}

var _ = Describe("BasicAuth config", func() {
	Context("when BASIC_AUTH_USERNAME is set with required fields", func() {
		BeforeEach(func() {
			hash, err := bcrypt.GenerateFromPassword([]byte("x"), bcrypt.MinCost)
			Expect(err).NotTo(HaveOccurred())
			GinkgoT().Setenv("BASIC_AUTH_USERNAME", "admin")
			GinkgoT().Setenv("BASIC_AUTH_PASSWORD_HASH", string(hash))
			GinkgoT().Setenv("OAUTH_COOKIE_SECRET", validHexSecret())
		})

		It("returns a basic-mode config", func() {
			cfg, err := LoadFromEnv()
			Expect(err).NotTo(HaveOccurred())
			Expect(cfg).NotTo(BeNil())
			Expect(cfg.Mode).To(Equal(ModeBasic))
			Expect(cfg.BasicUsername).To(Equal("admin"))
		})
	})

	Context("when BASIC_AUTH_PASSWORD_HASH is not a valid bcrypt hash", func() {
		It("returns an error at startup", func() {
			GinkgoT().Setenv("BASIC_AUTH_USERNAME", "admin")
			GinkgoT().Setenv("BASIC_AUTH_PASSWORD_HASH", "not-a-bcrypt-hash")
			GinkgoT().Setenv("OAUTH_COOKIE_SECRET", validHexSecret())

			_, err := LoadFromEnv()
			Expect(err).To(MatchError(ContainSubstring("not a valid bcrypt hash")))
		})
	})

	Context("when BASIC_AUTH_USERNAME is set without a hash", func() {
		It("returns an error", func() {
			GinkgoT().Setenv("BASIC_AUTH_USERNAME", "admin")
			GinkgoT().Setenv("OAUTH_COOKIE_SECRET", validHexSecret())

			_, err := LoadFromEnv()
			Expect(err).To(MatchError(ContainSubstring("BASIC_AUTH_PASSWORD_HASH")))
		})
	})

	Context("when both OIDC and basic env vars are set", func() {
		It("refuses to start", func() {
			setRequiredEnv()
			GinkgoT().Setenv("BASIC_AUTH_USERNAME", "admin")

			_, err := LoadFromEnv()
			Expect(err).To(MatchError(ContainSubstring("mutually exclusive")))
		})
	})
})

var _ = Describe("BasicAuth login", func() {
	const user, pass = "admin", "hunter2"

	It("renders the login form with a CSRF token on GET", func() {
		p := testBasicProvider(user, pass)
		req := httptest.NewRequest("GET", "/auth/login", nil)
		rec := httptest.NewRecorder()
		p.handleLogin(rec, req)

		Expect(rec.Code).To(Equal(http.StatusOK))
		Expect(rec.Body.String()).To(ContainSubstring("Sign in to Commander"))
		Expect(rec.Body.String()).To(ContainSubstring(`name="csrf"`))

		var csrf *http.Cookie
		for _, c := range rec.Result().Cookies() {
			if c.Name == csrfCookieName {
				csrf = c
			}
		}
		Expect(csrf).NotTo(BeNil())
		Expect(csrf.Value).NotTo(BeEmpty())
	})

	It("sets security headers on the login form", func() {
		p := testBasicProvider(user, pass)
		req := httptest.NewRequest("GET", "/auth/login", nil)
		rec := httptest.NewRecorder()
		p.handleLogin(rec, req)

		Expect(rec.Header().Get("X-Frame-Options")).To(Equal("DENY"))
		Expect(rec.Header().Get("Cache-Control")).To(ContainSubstring("no-store"))
		Expect(rec.Header().Get("Content-Security-Policy")).To(ContainSubstring("frame-ancestors"))
		Expect(rec.Header().Get("Referrer-Policy")).To(Equal("no-referrer"))
		Expect(rec.Header().Get("X-Content-Type-Options")).To(Equal("nosniff"))
	})

	It("rejects POSTs without a valid CSRF token", func() {
		p := testBasicProvider(user, pass)
		form := url.Values{"username": {user}, "password": {pass}}
		req := httptest.NewRequest("POST", "/auth/login", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		rec := httptest.NewRecorder()
		p.handleLogin(rec, req)

		Expect(rec.Code).To(Equal(http.StatusBadRequest))
	})

	It("rejects POSTs where the form token doesn't match the cookie", func() {
		p := testBasicProvider(user, pass)
		form := url.Values{"username": {user}, "password": {pass}, "csrf": {"bogus"}}
		req := httptest.NewRequest("POST", "/auth/login", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.AddCookie(&http.Cookie{Name: csrfCookieName, Value: "different"})
		rec := httptest.NewRecorder()
		p.handleLogin(rec, req)

		Expect(rec.Code).To(Equal(http.StatusBadRequest))
	})

	It("sets a session cookie on valid credentials", func() {
		p := testBasicProvider(user, pass)
		rec := loginAttempt(p, user, pass, "10.0.0.10:1234")

		Expect(rec.Code).To(Equal(http.StatusFound))
		var found bool
		for _, c := range rec.Result().Cookies() {
			if c.Name == defaultCookieName && c.Value != "" {
				found = true
			}
		}
		Expect(found).To(BeTrue())
	})

	It("rejects wrong passwords", func() {
		p := testBasicProvider(user, pass)
		rec := loginAttempt(p, user, "wrong", "10.0.0.1:1234")
		Expect(rec.Code).To(Equal(http.StatusUnauthorized))
	})

	It("rejects passwords longer than the bcrypt limit", func() {
		p := testBasicProvider(user, pass)
		// 73 bytes — one past the cap.
		long := strings.Repeat("a", maxPasswordLen+1)
		rec := loginAttempt(p, user, long, "10.0.0.99:1234")
		Expect(rec.Code).To(Equal(http.StatusUnauthorized))
	})

	It("gives a grace period before any lockout", func() {
		p := testBasicProvider(user, pass)
		const ip = "10.0.0.20"
		for i := 0; i < gracePeriod; i++ {
			rec := loginAttempt(p, user, "wrong", ip+":1234")
			Expect(rec.Code).To(Equal(http.StatusUnauthorized))
		}
		Expect(p.limiter.records[ip].count).To(Equal(gracePeriod))
		Expect(p.limiter.records[ip].lockedUntil.IsZero()).To(BeTrue())
	})

	It("applies exponential backoff after the grace period", func() {
		p := testBasicProvider(user, pass)
		const ip = "10.0.0.2"

		// Burn through the grace allotment.
		for i := 0; i < gracePeriod; i++ {
			_ = loginAttempt(p, user, "wrong", ip+":1234")
		}

		// Next failure → locked for ≈ backoffBase.
		before := time.Now()
		_ = loginAttempt(p, user, "wrong", ip+":1234")
		rec1 := p.limiter.records[ip]
		Expect(rec1.count).To(Equal(gracePeriod + 1))
		Expect(rec1.lockedUntil.Sub(before)).To(BeNumerically("~", backoffBase, 100*time.Millisecond))

		// Immediately retry — rate-limited before password check.
		rec := loginAttempt(p, user, pass, ip+":1234")
		Expect(rec.Code).To(Equal(http.StatusTooManyRequests))
		Expect(rec.Header().Get("Retry-After")).NotTo(BeEmpty())
		Expect(rec.Body.String()).To(ContainSubstring("Try again in"))

		// Force unlock, fail again → backoff doubles.
		p.limiter.records[ip].lockedUntil = time.Time{}
		before = time.Now()
		_ = loginAttempt(p, user, "wrong", ip+":1234")
		rec2 := p.limiter.records[ip]
		Expect(rec2.count).To(Equal(gracePeriod + 2))
		Expect(rec2.lockedUntil.Sub(before)).To(BeNumerically("~", 2*backoffBase, 100*time.Millisecond))
	})

	It("caps backoff at maxBackoff", func() {
		l := newBruteForceLimiter()
		before := time.Now()
		for i := 0; i < 40; i++ {
			l.recordFailure("10.0.0.4")
		}
		rec := l.records["10.0.0.4"]
		Expect(rec.lockedUntil.Sub(before)).To(BeNumerically("~", maxBackoff, 100*time.Millisecond))
	})

	It("clears failure state on successful login", func() {
		p := testBasicProvider(user, pass)
		const ip = "10.0.0.3"

		_ = loginAttempt(p, user, "wrong", ip+":1234")
		Expect(p.limiter.records[ip]).NotTo(BeNil())

		// Advance past the lockout window so the good attempt isn't blocked.
		p.limiter.records[ip].lockedUntil = p.limiter.records[ip].firstFail

		rec := loginAttempt(p, user, pass, ip+":1234")
		Expect(rec.Code).To(Equal(http.StatusFound))

		_, ok := p.limiter.records[ip]
		Expect(ok).To(BeFalse())
	})
})
