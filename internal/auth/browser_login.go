package auth

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type browserLoginRequest struct {
	Identity  string `json:"identity"`
	Password  string `json:"password"`
	CSRFToken string `json:"csrfToken"`
	Next      string `json:"next"`
}

func (p *Provider) handleBrowserLoginAPI(w http.ResponseWriter, r *http.Request) {
	if p.cfg.Mode != ModeLocal && p.cfg.Mode != ModeBasic {
		writeAuthError(w, http.StatusNotFound, "not found")
		return
	}

	if r.Method == http.MethodGet {
		token, err := p.issueCSRFToken(w)
		if err != nil {
			writeAuthError(w, http.StatusInternalServerError, "failed to initialize login")
			return
		}
		label, inputType := "Username", "text"
		if p.cfg.Mode == ModeLocal {
			label, inputType = "Email", "email"
		}
		writeAuthJSON(w, http.StatusOK, map[string]string{
			"csrfToken":     token,
			"identityLabel": label,
			"identityType":  inputType,
		})
		return
	}
	if r.Method != http.MethodPost {
		writeAuthError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var request browserLoginRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	if err := decoder.Decode(&request); err != nil {
		writeAuthError(w, http.StatusBadRequest, "invalid login request")
		return
	}
	if !p.validateCSRFToken(r, request.CSRFToken) {
		writeAuthError(w, http.StatusBadRequest, "login session expired; reload and try again")
		return
	}

	key := clientKey(r)
	if allowed, retryAfter := p.limiter.check(key); !allowed {
		w.Header().Set("Retry-After", retryAfterSeconds(retryAfter))
		writeAuthError(w, http.StatusTooManyRequests, "Too many failed attempts. Try again in "+humanDuration(retryAfter)+".")
		return
	}

	identity := strings.TrimSpace(request.Identity)
	password := request.Password
	var session Session
	valid := len(password) <= maxPasswordLen

	if p.cfg.Mode == ModeLocal {
		user, err := p.localStore.AuthenticateLocal(r.Context(), identity)
		valid = valid && err == nil && user.ID != "" && bcrypt.CompareHashAndPassword(user.PasswordHash, []byte(password)) == nil
		if valid {
			session = Session{Sub: user.ID, Email: user.Email, Name: user.Name}
		}
	} else {
		userOK := subtleStringEqual(identity, p.cfg.BasicUsername)
		passwordOK := bcrypt.CompareHashAndPassword(p.cfg.BasicPasswordHash, []byte(password)) == nil
		valid = valid && userOK && passwordOK
		if valid {
			session = Session{Sub: p.cfg.BasicUsername, Email: p.cfg.BasicUsername, Name: p.cfg.BasicUsername}
		}
	}

	if !valid {
		p.limiter.recordFailure(key)
		log.Printf("auth: failed browser login from %s", key)
		writeAuthError(w, http.StatusUnauthorized, "Invalid email or password.")
		return
	}

	session.Expires = time.Now().Add(p.cfg.SessionTTL).Unix()
	cookie, err := encodeSession(session, p.cfg.CookieSecret)
	if err != nil {
		writeAuthError(w, http.StatusInternalServerError, "failed to create session")
		return
	}
	p.limiter.recordSuccess(key)
	p.clearCookie(w, csrfCookieName)
	p.setCookie(w, p.cfg.CookieName, cookie, int(p.cfg.SessionTTL.Seconds()))
	writeAuthJSON(w, http.StatusOK, map[string]string{"next": safeLoginNext(request.Next)})
}

func safeLoginNext(next string) string {
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		return "/"
	}
	return next
}

func writeAuthJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeAuthError(w http.ResponseWriter, status int, message string) {
	writeAuthJSON(w, status, map[string]string{"error": message})
}
