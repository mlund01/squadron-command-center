package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func testProvider() *Provider {
	return &Provider{
		cfg: &Config{
			CookieSecret: testSecret,
			CookieName:   "test_session",
			CookieSecure: false,
			SessionTTL:   time.Hour,
		},
	}
}

func validSessionCookie(p *Provider) *http.Cookie {
	sess := Session{
		Sub:     "user-1",
		Email:   "test@example.com",
		Name:    "Test User",
		Expires: time.Now().Add(time.Hour).Unix(),
	}
	val, err := encodeSession(sess, p.cfg.CookieSecret)
	Expect(err).NotTo(HaveOccurred())
	return &http.Cookie{Name: p.cfg.CookieName, Value: val}
}

var _ = Describe("Middleware", func() {
	var (
		p       *Provider
		called  bool
		gotSess *Session
		handler http.Handler
	)

	BeforeEach(func() {
		p = testProvider()
		called = false
		gotSess = nil
		handler = p.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			gotSess = SessionFromContext(r.Context())
			w.WriteHeader(http.StatusOK)
		}))
	})

	Context("with a valid session cookie", func() {
		It("calls the next handler with the session in context", func() {
			req := httptest.NewRequest("GET", "/api/instances", nil)
			req.AddCookie(validSessionCookie(p))
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			Expect(called).To(BeTrue())
			Expect(gotSess).NotTo(BeNil())
			Expect(gotSess.Email).To(Equal("test@example.com"))
			Expect(rec.Code).To(Equal(http.StatusOK))
		})
	})

	Context("without a cookie", func() {
		It("returns 401 JSON for API requests", func() {
			req := httptest.NewRequest("GET", "/api/instances", nil)
			req.Header.Set("Accept", "application/json")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			Expect(called).To(BeFalse())
			Expect(rec.Code).To(Equal(http.StatusUnauthorized))

			var body map[string]string
			Expect(json.NewDecoder(rec.Body).Decode(&body)).To(Succeed())
			Expect(body["error"]).To(Equal("unauthorized"))
		})

		It("redirects HTML GET requests to /auth/login", func() {
			req := httptest.NewRequest("GET", "/instances/abc/missions", nil)
			req.Header.Set("Accept", "text/html,application/xhtml+xml")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			Expect(called).To(BeFalse())
			Expect(rec.Code).To(Equal(http.StatusFound))
			Expect(rec.Header().Get("Location")).To(Equal(
				"/auth/login?next=%2Finstances%2Fabc%2Fmissions",
			))
		})

		It("preserves query string in the redirect next parameter", func() {
			req := httptest.NewRequest("GET", "/instances/abc/costs?from=2026-01-01", nil)
			req.Header.Set("Accept", "text/html")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			Expect(rec.Code).To(Equal(http.StatusFound))
			Expect(rec.Header().Get("Location")).To(Equal(
				"/auth/login?next=%2Finstances%2Fabc%2Fcosts%3Ffrom%3D2026-01-01",
			))
		})
	})

	Context("with an expired session cookie", func() {
		It("returns 401", func() {
			sess := Session{
				Email:   "old@example.com",
				Expires: time.Now().Add(-time.Minute).Unix(),
			}
			val, err := encodeSession(sess, p.cfg.CookieSecret)
			Expect(err).NotTo(HaveOccurred())

			req := httptest.NewRequest("GET", "/api/instances", nil)
			req.AddCookie(&http.Cookie{Name: p.cfg.CookieName, Value: val})
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			Expect(called).To(BeFalse())
			Expect(rec.Code).To(Equal(http.StatusUnauthorized))
		})
	})

	Context("with a tampered cookie", func() {
		It("returns 401", func() {
			req := httptest.NewRequest("GET", "/api/instances", nil)
			req.AddCookie(&http.Cookie{Name: p.cfg.CookieName, Value: "tampered.garbage"})
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			Expect(called).To(BeFalse())
			Expect(rec.Code).To(Equal(http.StatusUnauthorized))
		})
	})

	Context("with an /auth/ path", func() {
		It("passes through without requiring a cookie", func() {
			req := httptest.NewRequest("GET", "/auth/login", nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			Expect(called).To(BeTrue())
			Expect(rec.Code).To(Equal(http.StatusOK))
		})
	})
})

var _ = Describe("SessionFromContext", func() {
	It("returns nil when no session is attached", func() {
		req := httptest.NewRequest("GET", "/", nil)
		Expect(SessionFromContext(req.Context())).To(BeNil())
	})
})
