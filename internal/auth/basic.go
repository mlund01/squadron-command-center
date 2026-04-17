package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"html/template"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Brute-force tuning. Every failure produces a per-IP lockout that doubles
// with each consecutive failure inside the window, capped at maxBackoff.
// A human who fat-fingers once waits ~1s; a script that keeps guessing hits
// exponential pain fast (by failure 11 it's waiting ~15 min between tries).
const (
	failureWindow     = 15 * time.Minute
	backoffBase       = 1 * time.Second
	maxBackoff        = 15 * time.Minute
	limiterGCInterval = 10 * time.Minute
	limiterRecordTTL  = 1 * time.Hour

	// Password length cap. bcrypt silently truncates at 72 bytes, so accepting
	// longer inputs quietly authenticates the wrong user if two passphrases
	// share the first 72 bytes. Reject up front.
	maxPasswordLen = 72

	csrfCookieName = "commander_csrf"
	csrfCookieTTL  = 30 * time.Minute
)

// bruteForceLimiter tracks failed login attempts per IP. State lives in
// memory only — on restart every attacker gets a fresh slate, but so does
// every legitimate user locked out before the crash. Fine for a single-
// instance deployment; a horizontally-scaled deployment would need a shared
// store (but if you're scaling horizontally, you should be on OIDC anyway).
type bruteForceLimiter struct {
	mu      sync.Mutex
	records map[string]*attemptRecord
	lastGC  time.Time
}

type attemptRecord struct {
	count       int
	firstFail   time.Time
	lockedUntil time.Time
}

func newBruteForceLimiter() *bruteForceLimiter {
	return &bruteForceLimiter{
		records: make(map[string]*attemptRecord),
		lastGC:  time.Now(),
	}
}

// check reports whether the given key (IP) is currently allowed to attempt
// a login. If locked, returns the remaining lockout duration.
func (l *bruteForceLimiter) check(key string) (allowed bool, retryAfter time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.gcLocked()

	rec, ok := l.records[key]
	if !ok {
		return true, 0
	}
	now := time.Now()
	if now.Before(rec.lockedUntil) {
		return false, rec.lockedUntil.Sub(now)
	}
	return true, 0
}

// recordFailure bumps the failure counter for key and sets an exponentially
// growing lockout. Consecutive failures inside failureWindow double the wait.
func (l *bruteForceLimiter) recordFailure(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.gcLocked()

	now := time.Now()
	rec := l.records[key]
	if rec == nil || now.Sub(rec.firstFail) > failureWindow {
		rec = &attemptRecord{firstFail: now}
		l.records[key] = rec
	}
	rec.count++

	// backoff = backoffBase * 2^(count-1), capped at maxBackoff. Using a loop
	// instead of math.Pow keeps us dependency-free and avoids float rounding.
	backoff := backoffBase
	for i := 1; i < rec.count && backoff < maxBackoff; i++ {
		backoff *= 2
	}
	if backoff > maxBackoff {
		backoff = maxBackoff
	}
	rec.lockedUntil = now.Add(backoff)
}

// recordSuccess clears any pending failure state for key.
func (l *bruteForceLimiter) recordSuccess(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.records, key)
}

// gcLocked removes stale records. Called under l.mu.
func (l *bruteForceLimiter) gcLocked() {
	now := time.Now()
	if now.Sub(l.lastGC) < limiterGCInterval {
		return
	}
	l.lastGC = now
	for k, rec := range l.records {
		if now.After(rec.lockedUntil) && now.Sub(rec.firstFail) > limiterRecordTTL {
			delete(l.records, k)
		}
	}
}

// clientKey extracts the best-effort client identifier for rate-limiting.
// Prefers the leftmost entry in X-Forwarded-For when present (Fly/Cloudflare),
// falling back to RemoteAddr.
func clientKey(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if comma := strings.IndexByte(xff, ','); comma >= 0 {
			xff = xff[:comma]
		}
		if ip := strings.TrimSpace(xff); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

var basicLoginTmpl = template.Must(template.New("login").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign in — Commander</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,sans-serif;background:#0e1116;color:#e6edf3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  form{background:#161b22;padding:2rem;border-radius:8px;min-width:320px;box-shadow:0 4px 24px rgba(0,0,0,.4)}
  h1{margin:0 0 1rem;font-size:1.25rem}
  label{display:block;margin:.75rem 0 .25rem;font-size:.85rem;color:#9da7b3}
  input{width:100%;box-sizing:border-box;padding:.5rem;background:#0e1116;border:1px solid #30363d;color:#e6edf3;border-radius:4px}
  button{margin-top:1rem;width:100%;padding:.6rem;background:#238636;color:#fff;border:0;border-radius:4px;cursor:pointer;font-weight:600}
  button:hover{background:#2ea043}
  .err{color:#f85149;margin-top:.75rem;font-size:.85rem}
</style></head><body>
<form method="post" action="/auth/login">
  <h1>Sign in to Commander</h1>
  <input type="hidden" name="next" value="{{.Next}}">
  <input type="hidden" name="csrf" value="{{.CSRFToken}}">
  <label>Username</label>
  <input name="username" autocomplete="username" autofocus required>
  <label>Password</label>
  <input name="password" type="password" autocomplete="current-password" required maxlength="72">
  {{if .Error}}<div class="err">{{.Error}}</div>{{end}}
  <button type="submit">Sign in</button>
</form></body></html>`))

// handleBasicLogin serves the login form (GET) and verifies credentials
// (POST) in basic-auth mode.
func (p *Provider) handleBasicLogin(w http.ResponseWriter, r *http.Request) {
	next := r.URL.Query().Get("next")
	if r.Method == http.MethodPost {
		next = r.FormValue("next")
	}
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		next = "/"
	}

	if r.Method == http.MethodGet {
		token, err := p.issueCSRFToken(w)
		if err != nil {
			http.Error(w, "failed to issue csrf token", http.StatusInternalServerError)
			return
		}
		p.renderLogin(w, next, token, "", http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// CSRF: synchronizer token via cookie + hidden form field, compared
	// constant-time. A cross-origin form post can't read the victim's cookie
	// to forge a matching value, so login-CSRF is blocked.
	if !p.validateCSRF(r) {
		// Reissue so the user's retry after this error works.
		token, _ := p.issueCSRFToken(w)
		p.renderLogin(w, next, token, "Session expired. Please try again.", http.StatusBadRequest)
		return
	}

	key := clientKey(r)
	if allowed, retryAfter := p.limiter.check(key); !allowed {
		w.Header().Set("Retry-After", retryAfterSeconds(retryAfter))
		token, _ := p.issueCSRFToken(w)
		p.renderLogin(w, next, token, "Too many failed attempts. Try again later.", http.StatusTooManyRequests)
		return
	}

	username := r.FormValue("username")
	password := r.FormValue("password")

	// Reject oversized passwords before hitting bcrypt. bcrypt silently
	// truncates at 72 bytes, so accepting longer inputs could authenticate
	// the wrong user when two long passphrases share a prefix.
	if len(password) > maxPasswordLen {
		p.limiter.recordFailure(key)
		log.Printf("auth: rejected oversized password from %s", key)
		token, _ := p.issueCSRFToken(w)
		p.renderLogin(w, next, token, "Invalid username or password.", http.StatusUnauthorized)
		return
	}

	// Constant-time-ish compare: always run bcrypt even if the username
	// doesn't match, so timing doesn't leak which field was wrong.
	userOK := subtleStringEqual(username, p.cfg.BasicUsername)
	passErr := bcrypt.CompareHashAndPassword(p.cfg.BasicPasswordHash, []byte(password))

	if !userOK || passErr != nil {
		p.limiter.recordFailure(key)
		log.Printf("auth: failed basic login from %s", key)
		token, _ := p.issueCSRFToken(w)
		p.renderLogin(w, next, token, "Invalid username or password.", http.StatusUnauthorized)
		return
	}

	p.limiter.recordSuccess(key)
	log.Printf("auth: successful basic login from %s", key)
	p.clearCookie(w, csrfCookieName)

	sess := Session{
		Sub:     p.cfg.BasicUsername,
		Email:   p.cfg.BasicUsername,
		Name:    p.cfg.BasicUsername,
		Expires: time.Now().Add(p.cfg.SessionTTL).Unix(),
	}
	sessCookie, err := encodeSession(sess, p.cfg.CookieSecret)
	if err != nil {
		http.Error(w, "failed to encode session", http.StatusInternalServerError)
		return
	}
	p.setCookie(w, p.cfg.CookieName, sessCookie, int(p.cfg.SessionTTL.Seconds()))
	http.Redirect(w, r, next, http.StatusFound)
}

func (p *Provider) renderLogin(w http.ResponseWriter, next, csrfToken, errMsg string, status int) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	// Don't let intermediaries or the browser cache the login form — stale
	// CSRF tokens cause legitimate login failures, and a cached page can leak
	// form state. `no-store` is the strongest option.
	h.Set("Cache-Control", "no-store")
	h.Set("Pragma", "no-cache")
	// Block framing (clickjacking) — the login page has no reason to be
	// embedded anywhere. `frame-ancestors 'none'` is the modern equivalent
	// and also overrides any ancestor's permissions.
	h.Set("X-Frame-Options", "DENY")
	h.Set("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'")
	// Don't leak the login URL (or any `next=` param) via Referer when the
	// browser navigates away after submission.
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")

	w.WriteHeader(status)
	_ = basicLoginTmpl.Execute(w, struct {
		Next      string
		CSRFToken string
		Error     string
	}{Next: next, CSRFToken: csrfToken, Error: errMsg})
}

// issueCSRFToken generates a random token, sets it as a cookie, and returns
// it for embedding in the form. The cookie is HttpOnly — the form's hidden
// field is the only place JS could read it from, and it's not exposed there
// either (server-rendered HTML).
func (p *Provider) issueCSRFToken(w http.ResponseWriter) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	p.setCookie(w, csrfCookieName, token, int(csrfCookieTTL.Seconds()))
	return token, nil
}

// validateCSRF compares the cookie and form values in constant time. Both
// must be present and equal; a missing cookie is treated as a failure.
func (p *Provider) validateCSRF(r *http.Request) bool {
	cookie, err := r.Cookie(csrfCookieName)
	if err != nil || cookie.Value == "" {
		return false
	}
	formVal := r.FormValue("csrf")
	if formVal == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(formVal)) == 1
}

func retryAfterSeconds(d time.Duration) string {
	secs := int(d.Seconds())
	if secs < 1 {
		secs = 1
	}
	// itoa without pulling strconv just for this — stay small
	return itoa(secs)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// subtleStringEqual compares two strings in constant time. The stdlib
// function returns 0 for unequal-length inputs (after doing the compare),
// which is what we want here — bcrypt dominates the total timing anyway.
func subtleStringEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
