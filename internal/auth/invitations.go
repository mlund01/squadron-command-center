package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

type invitationStore interface {
	InvitationUser(context.Context, string) (LocalUser, error)
	AcceptInvitation(context.Context, string, []byte) (LocalUser, error)
}

func (p *Provider) handleInvitation(w http.ResponseWriter, r *http.Request) {
	store, ok := p.localStore.(invitationStore)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodGet {
		user, err := store.InvitationUser(r.Context(), r.URL.Query().Get("token"))
		if err != nil {
			writeInvitationError(w, http.StatusNotFound, "invitation is invalid or expired")
			return
		}
		writeInvitationJSON(w, http.StatusOK, map[string]string{"email": user.Email, "name": user.Name})
		return
	}
	var body struct{ Token, Password, PasswordConfirm string }
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	if err := decoder.Decode(&body); err != nil {
		writeInvitationError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if len(body.Password) < 12 || len(body.Password) > maxPasswordLen || body.Password != body.PasswordConfirm || strings.TrimSpace(body.Token) == "" {
		writeInvitationError(w, http.StatusBadRequest, "use matching passwords of at least 12 characters")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeInvitationError(w, http.StatusInternalServerError, "unable to secure password")
		return
	}
	user, err := store.AcceptInvitation(r.Context(), body.Token, hash)
	if err != nil {
		writeInvitationError(w, http.StatusNotFound, "invitation is invalid or expired")
		return
	}
	p.setLocalSession(w, user)
	writeInvitationJSON(w, http.StatusOK, map[string]string{"status": "active"})
}
func writeInvitationJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeInvitationError(w http.ResponseWriter, status int, message string) {
	writeInvitationJSON(w, status, map[string]string{"error": message})
}
