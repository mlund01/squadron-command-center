package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

const pendingCookieName = "commander_oauth_pending"
const pendingCookieTTL = 5 * time.Minute

func (p *Provider) setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   p.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (p *Provider) clearCookie(w http.ResponseWriter, name string) {
	p.setCookie(w, name, "", -1)
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
}

// RegisterRoutes hooks the four auth endpoints into mux.
func (p *Provider) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/auth/login", p.handleLogin)
	mux.HandleFunc("/auth/callback", p.handleCallback)
	mux.HandleFunc("/auth/logout", p.handleLogout)
	mux.HandleFunc("/auth/me", p.handleMe)
}

func (p *Provider) handleLogin(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Mode == ModeBasic {
		p.handleBasicLogin(w, r)
		return
	}
	next := r.URL.Query().Get("next")
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		next = "/"
	}

	state, err := randomString(32)
	if err != nil {
		http.Error(w, "failed to generate state", http.StatusInternalServerError)
		return
	}
	verifier, err := randomString(48)
	if err != nil {
		http.Error(w, "failed to generate verifier", http.StatusInternalServerError)
		return
	}

	pending := pendingState{
		State:    state,
		Verifier: verifier,
		Next:     next,
		Expires:  time.Now().Add(pendingCookieTTL).Unix(),
	}
	pendingCookie, err := encodePending(pending, p.cfg.CookieSecret)
	if err != nil {
		http.Error(w, "failed to encode pending state", http.StatusInternalServerError)
		return
	}
	p.setCookie(w, pendingCookieName, pendingCookie, int(pendingCookieTTL.Seconds()))

	challenge := pkceChallenge(verifier)
	opts := []oauth2.AuthCodeOption{
		oauth2.SetAuthURLParam("code_challenge", challenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	}
	if p.cfg.Audience != "" {
		opts = append(opts, oauth2.SetAuthURLParam("audience", p.cfg.Audience))
	}

	http.Redirect(w, r, p.oauth.AuthCodeURL(state, opts...), http.StatusFound)
}

func (p *Provider) handleCallback(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Mode == ModeBasic {
		http.NotFound(w, r)
		return
	}
	if errCode := r.URL.Query().Get("error"); errCode != "" {
		desc := r.URL.Query().Get("error_description")
		http.Error(w, fmt.Sprintf("oauth error: %s: %s", errCode, desc), http.StatusBadRequest)
		return
	}

	cookie, err := r.Cookie(pendingCookieName)
	if err != nil {
		http.Error(w, "missing oauth flow cookie", http.StatusBadRequest)
		return
	}
	pending, err := decodePending(cookie.Value, p.cfg.CookieSecret)
	if err != nil {
		http.Error(w, "invalid oauth flow cookie", http.StatusBadRequest)
		return
	}
	// One-shot — clear regardless of outcome.
	p.clearCookie(w, pendingCookieName)

	if r.URL.Query().Get("state") != pending.State {
		http.Error(w, "oauth state mismatch", http.StatusBadRequest)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "missing authorization code", http.StatusBadRequest)
		return
	}

	token, err := p.oauth.Exchange(r.Context(), code,
		oauth2.SetAuthURLParam("code_verifier", pending.Verifier),
	)
	if err != nil {
		log.Printf("auth: token exchange failed: %v", err)
		http.Error(w, "token exchange failed", http.StatusBadGateway)
		return
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		http.Error(w, "no id_token in response", http.StatusBadGateway)
		return
	}

	idToken, err := p.verifier.Verify(r.Context(), rawIDToken)
	if err != nil {
		log.Printf("auth: id token verify failed: %v", err)
		http.Error(w, "id token verification failed", http.StatusUnauthorized)
		return
	}

	var claims struct {
		Sub   string `json:"sub"`
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		http.Error(w, "failed to parse id token claims", http.StatusInternalServerError)
		return
	}

	if !p.cfg.EmailAllowed(claims.Email) {
		log.Printf("auth: rejected login for disallowed email %q", claims.Email)
		http.Error(w, "this account is not permitted to access commander", http.StatusForbidden)
		return
	}

	sess := Session{
		Sub:     claims.Sub,
		Email:   claims.Email,
		Name:    claims.Name,
		Expires: time.Now().Add(p.cfg.SessionTTL).Unix(),
	}
	sessCookie, err := encodeSession(sess, p.cfg.CookieSecret)
	if err != nil {
		http.Error(w, "failed to encode session", http.StatusInternalServerError)
		return
	}
	p.setCookie(w, p.cfg.CookieName, sessCookie, int(p.cfg.SessionTTL.Seconds()))

	next := pending.Next
	if next == "" {
		next = "/"
	}
	http.Redirect(w, r, next, http.StatusFound)
}

// handleLogout clears the session cookie and, if the provider advertised
// an end_session_endpoint, redirects there with the OIDC RP-initiated
// logout parameters. Auth0 honors these.
func (p *Provider) handleLogout(w http.ResponseWriter, r *http.Request) {
	p.clearCookie(w, p.cfg.CookieName)

	if p.cfg.Mode == ModeBasic {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}

	returnTo := baseURL(p.cfg.RedirectURL)
	if p.logoutURL != "" {
		u, err := url.Parse(p.logoutURL)
		if err == nil {
			q := u.Query()
			q.Set("client_id", p.cfg.ClientID)
			q.Set("post_logout_redirect_uri", returnTo)
			q.Set("returnTo", returnTo) // Auth0 legacy name, harmless for others
			u.RawQuery = q.Encode()
			http.Redirect(w, r, u.String(), http.StatusFound)
			return
		}
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

func (p *Provider) handleMe(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(p.cfg.CookieName)
	if err != nil {
		writeUnauthorized(w)
		return
	}
	sess, err := decodeSession(cookie.Value, p.cfg.CookieSecret)
	if err != nil {
		writeUnauthorized(w)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"email": sess.Email,
		"name":  sess.Name,
		"sub":   sess.Sub,
	})
}

func randomString(nBytes int) (string, error) {
	buf := make([]byte, nBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func pkceChallenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// baseURL returns the scheme://host portion of rawURL. Used to build a safe
// post_logout_redirect_uri from the configured redirect URL.
func baseURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "/"
	}
	return u.Scheme + "://" + u.Host + "/"
}
