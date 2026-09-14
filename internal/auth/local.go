package auth

import (
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const setupRequestLimit = 16 << 10

type setupResponse struct {
	Claimed       bool   `json:"claimed"`
	CSRFToken     string `json:"csrfToken,omitempty"`
	RequiresToken bool   `json:"requiresToken"`
}

type setupRequest struct {
	Email           string `json:"email"`
	Name            string `json:"name"`
	Password        string `json:"password"`
	PasswordConfirm string `json:"passwordConfirm"`
	SetupToken      string `json:"setupToken"`
	CSRFToken       string `json:"csrfToken"`
}

// handleSetup is the API behind the Command Center first-run setup page.
func (p *Provider) handleSetup(w http.ResponseWriter, r *http.Request) {
	claimed, err := p.localStore.IsClaimed(r.Context())
	if err != nil {
		writeSetupError(w, http.StatusServiceUnavailable, "setup status unavailable")
		return
	}

	switch r.Method {
	case http.MethodGet:
		p.writeSetupStatus(w, claimed)
	case http.MethodPost:
		if claimed {
			writeSetupError(w, http.StatusConflict, "command center is already claimed")
			return
		}
		p.claimInitialAdmin(w, r)
	default:
		writeSetupError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (p *Provider) writeSetupStatus(w http.ResponseWriter, claimed bool) {
	token, err := p.issueCSRFToken(w)
	if err != nil {
		writeSetupError(w, http.StatusInternalServerError, "failed to initialize setup")
		return
	}

	writeSetupJSON(w, http.StatusOK, setupResponse{
		Claimed:       claimed,
		CSRFToken:     token,
		RequiresToken: p.setupToken != "",
	})
}

func (p *Provider) claimInitialAdmin(w http.ResponseWriter, r *http.Request) {
	var request setupRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, setupRequestLimit))
	if err := decoder.Decode(&request); err != nil {
		writeSetupError(w, http.StatusBadRequest, "invalid setup request")
		return
	}

	if !p.validateCSRFToken(r, request.CSRFToken) {
		writeSetupError(w, http.StatusBadRequest, "setup session expired; reload and try again")
		return
	}

	email := strings.TrimSpace(request.Email)
	if email == "" || len(request.Password) < 12 || len(request.Password) > maxPasswordLen || request.Password != request.PasswordConfirm {
		writeSetupError(w, http.StatusBadRequest, "use a valid email and a matching password of at least 12 characters")
		return
	}

	if p.setupToken != "" && subtle.ConstantTimeCompare([]byte(request.SetupToken), []byte(p.setupToken)) != 1 {
		writeSetupError(w, http.StatusForbidden, "invalid setup token")
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(request.Password), bcrypt.DefaultCost)
	if err != nil {
		writeSetupError(w, http.StatusInternalServerError, "failed to secure password")
		return
	}

	user, err := p.localStore.ClaimInitialAdmin(r.Context(), email, strings.TrimSpace(request.Name), passwordHash)
	if err != nil {
		log.Printf("auth: initial admin setup failed: %v", err)
		writeSetupError(w, http.StatusConflict, "command center was claimed by another setup session")
		return
	}

	p.setLocalSession(w, user)
	writeSetupJSON(w, http.StatusCreated, setupResponse{Claimed: true})
}

func (p *Provider) handleLocalLogin(w http.ResponseWriter, r *http.Request) {
	claimed, err := p.localStore.IsClaimed(r.Context())
	if err != nil {
		http.Error(w, "login unavailable", http.StatusServiceUnavailable)
		return
	}
	if !claimed {
		http.Redirect(w, r, "/setup", http.StatusFound)
		return
	}

	next := loginNextURL(r)
	if r.Method == http.MethodGet {
		p.renderLoginWithFreshCSRF(w, next, "", http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !p.validateCSRF(r) {
		p.renderLoginWithFreshCSRF(w, next, "Session expired. Please try again.", http.StatusBadRequest)
		return
	}

	key := clientKey(r)
	if allowed, retryAfter := p.limiter.check(key); !allowed {
		w.Header().Set("Retry-After", retryAfterSeconds(retryAfter))
		p.renderLoginWithFreshCSRF(w, next, "Too many failed attempts. Try again in "+humanDuration(retryAfter)+".", http.StatusTooManyRequests)
		return
	}

	password := r.FormValue("password")
	user, err := p.localStore.AuthenticateLocal(r.Context(), r.FormValue("username"))
	if err != nil || len(password) > maxPasswordLen || user.ID == "" || bcrypt.CompareHashAndPassword(user.PasswordHash, []byte(password)) != nil {
		p.limiter.recordFailure(key)
		log.Printf("auth: failed local login from %s", key)
		p.renderLoginWithFreshCSRF(w, next, "Invalid email or password.", http.StatusUnauthorized)
		return
	}

	p.limiter.recordSuccess(key)
	p.clearCookie(w, csrfCookieName)
	p.setLocalSession(w, user)
	http.Redirect(w, r, next, http.StatusFound)
}

func loginNextURL(r *http.Request) string {
	next := r.URL.Query().Get("next")
	if r.Method == http.MethodPost {
		next = r.FormValue("next")
	}
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		return "/"
	}
	return next
}

func (p *Provider) renderLoginWithFreshCSRF(w http.ResponseWriter, next, message string, status int) {
	token, err := p.issueCSRFToken(w)
	if err != nil {
		http.Error(w, "failed to issue csrf token", http.StatusInternalServerError)
		return
	}
	p.renderLogin(w, next, token, message, status)
}

func (p *Provider) setLocalSession(w http.ResponseWriter, user LocalUser) {
	cookie, err := encodeSession(Session{
		Sub:     user.ID,
		Email:   user.Email,
		Name:    user.Name,
		Expires: time.Now().Add(p.cfg.SessionTTL).Unix(),
	}, p.cfg.CookieSecret)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	p.setCookie(w, p.cfg.CookieName, cookie, int(p.cfg.SessionTTL.Seconds()))
}

func writeSetupJSON(w http.ResponseWriter, status int, value setupResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeSetupError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
