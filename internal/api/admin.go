package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"commander/internal/controlplane"
)

type AdminStore interface {
	UserForSubject(context.Context, string) (controlplane.User, error)
	ListAdminUsers(context.Context) ([]controlplane.AdminUser, error)
	CreateAdminUser(context.Context, controlplane.User, string, string, string) (controlplane.AdminUser, string, error)
	UpdateAdminUser(context.Context, controlplane.User, string, string, string, string) (controlplane.AdminUser, error)
	ListServicePrincipals(context.Context) ([]controlplane.ServicePrincipal, error)
	CreateServicePrincipal(context.Context, controlplane.User, string, string) (controlplane.ServicePrincipal, string, error)
	UpdateServicePrincipalStatus(context.Context, controlplane.User, string, string) (controlplane.ServicePrincipal, error)
	RotateServicePrincipalCredential(context.Context, controlplane.User, string) (string, error)
	ListAuditEvents(context.Context, int) ([]controlplane.AuditEvent, error)
	ListWorkspaceUserGrants(context.Context) ([]controlplane.WorkspaceUserGrant, error)
	ListWorkspaceServicePrincipalGrants(context.Context) ([]controlplane.WorkspaceServicePrincipalGrant, error)
	SetWorkspaceUserGrant(context.Context, controlplane.User, string, string, string, []string) error
	SetWorkspaceServicePrincipalGrant(context.Context, controlplane.User, string, string, []string, []string) error
	RemoveWorkspaceUserGrant(context.Context, controlplane.User, string, string) error
	RemoveWorkspaceServicePrincipalGrant(context.Context, controlplane.User, string, string) error
}

func handleAdminServicePrincipal(store AdminStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := currentAdmin(w, r, store)
		if !ok {
			return
		}
		var body struct{ Status string }
		if err := decodeAdminJSON(w, r, &body); err != nil {
			return
		}
		if body.Status != "active" && body.Status != "disabled" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "status must be active or disabled"})
			return
		}
		principal, err := store.UpdateServicePrincipalStatus(r.Context(), actor, r.PathValue("id"), body.Status)
		if errors.Is(err, controlplane.ErrUserNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "service principal not found"})
			return
		}
		if err != nil {
			adminUnavailable(w)
			return
		}
		writeJSON(w, http.StatusOK, principal)
	}
}

func handleRotateServicePrincipalCredential(store AdminStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := currentAdmin(w, r, store)
		if !ok {
			return
		}
		credential, err := store.RotateServicePrincipalCredential(r.Context(), actor, r.PathValue("id"))
		if errors.Is(err, controlplane.ErrUserNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "service principal not found"})
			return
		}
		if err != nil {
			adminUnavailable(w)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"credential": credential})
	}
}

func handleAdminAudit(store AdminStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := currentAdmin(w, r, store); !ok {
			return
		}
		events, err := store.ListAuditEvents(r.Context(), 200)
		if err != nil {
			adminUnavailable(w)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"events": events})
	}
}

func handleAdminUsers(store AdminStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := currentAdmin(w, r, store)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			users, err := store.ListAdminUsers(r.Context())
			if err != nil {
				adminUnavailable(w)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"users": users})
			return
		}
		var body struct{ Email, Name, Role string }
		if err := decodeAdminJSON(w, r, &body); err != nil {
			return
		}
		if !validEmail(body.Email) || strings.TrimSpace(body.Name) == "" || !validCCRole(body.Role) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name, valid email, and Command Center role are required"})
			return
		}
		user, invitation, err := store.CreateAdminUser(r.Context(), actor, body.Email, body.Name, body.Role)
		if err != nil {
			if isUniqueViolation(err) {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "a user with that email already exists"})
			} else {
				adminUnavailable(w)
			}
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"user": user, "invitationToken": invitation})
	}
}

func handleAdminUser(store AdminStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := currentAdmin(w, r, store)
		if !ok {
			return
		}
		var body struct{ Name, Role, Status string }
		if err := decodeAdminJSON(w, r, &body); err != nil {
			return
		}
		if strings.TrimSpace(body.Name) == "" || !validCCRole(body.Role) || !validUserStatus(body.Status) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "valid name, role, and status are required"})
			return
		}
		user, err := store.UpdateAdminUser(r.Context(), actor, r.PathValue("id"), body.Name, body.Role, body.Status)
		if errors.Is(err, controlplane.ErrLastAdministrator) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		if errors.Is(err, controlplane.ErrUserNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
			return
		}
		if err != nil {
			adminUnavailable(w)
			return
		}
		writeJSON(w, http.StatusOK, user)
	}
}

func handleAdminServicePrincipals(store AdminStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := currentAdmin(w, r, store)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			principals, err := store.ListServicePrincipals(r.Context())
			if err != nil {
				adminUnavailable(w)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"servicePrincipals": principals})
			return
		}
		var body struct{ Name, Description string }
		if err := decodeAdminJSON(w, r, &body); err != nil {
			return
		}
		if strings.TrimSpace(body.Name) == "" || len(body.Name) > 120 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name must be between 1 and 120 characters"})
			return
		}
		principal, secret, err := store.CreateServicePrincipal(r.Context(), actor, body.Name, body.Description)
		if err != nil {
			if isUniqueViolation(err) {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "a service principal with that name already exists"})
			} else {
				adminUnavailable(w)
			}
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"servicePrincipal": principal, "credential": secret})
	}
}

func handleAdminAccess(store AdminStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := currentAdmin(w, r, store); !ok {
			return
		}
		users, err := store.ListWorkspaceUserGrants(r.Context())
		if err != nil {
			adminUnavailable(w)
			return
		}
		principals, err := store.ListWorkspaceServicePrincipalGrants(r.Context())
		if err != nil {
			adminUnavailable(w)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"users": users, "servicePrincipals": principals})
	}
}

func handleAdminWorkspaceUserAccess(store AdminStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := currentAdmin(w, r, store)
		if !ok {
			return
		}
		if r.Method == http.MethodDelete {
			if err := store.RemoveWorkspaceUserGrant(r.Context(), actor, r.PathValue("workspaceId"), r.PathValue("userId")); err != nil {
				adminUnavailable(w)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var body struct {
			Role     string   `json:"role"`
			Missions []string `json:"missions"`
		}
		if err := decodeAdminJSON(w, r, &body); err != nil {
			return
		}
		if !validWorkspaceRole(body.Role) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workspace role"})
			return
		}
		if err := store.SetWorkspaceUserGrant(r.Context(), actor, r.PathValue("workspaceId"), r.PathValue("userId"), body.Role, body.Missions); err != nil {
			adminUnavailable(w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleAdminWorkspaceServicePrincipalAccess(store AdminStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := currentAdmin(w, r, store)
		if !ok {
			return
		}
		if r.Method == http.MethodDelete {
			if err := store.RemoveWorkspaceServicePrincipalGrant(r.Context(), actor, r.PathValue("workspaceId"), r.PathValue("servicePrincipalId")); err != nil {
				adminUnavailable(w)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var body struct {
			Missions []string `json:"missions"`
			UserIDs  []string `json:"userIds"`
		}
		if err := decodeAdminJSON(w, r, &body); err != nil {
			return
		}
		if err := store.SetWorkspaceServicePrincipalGrant(r.Context(), actor, r.PathValue("workspaceId"), r.PathValue("servicePrincipalId"), body.Missions, body.UserIDs); err != nil {
			adminUnavailable(w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func currentAdmin(w http.ResponseWriter, r *http.Request, store interface {
	UserForSubject(context.Context, string) (controlplane.User, error)
}) (controlplane.User, bool) {
	user, ok := currentControlPlaneUser(w, r, store)
	if !ok {
		return controlplane.User{}, false
	}
	if user.Role != controlplane.RoleAdmin {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Command Center administrator access is required"})
		return controlplane.User{}, false
	}
	return user, true
}

func decodeAdminJSON(w http.ResponseWriter, r *http.Request, target any) error {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return err
	}
	return nil
}
func validCCRole(v string) bool { return v == controlplane.RoleAdmin || v == controlplane.RoleMember }
func validWorkspaceRole(v string) bool {
	return v == "reader" || v == "developer" || v == "manager" || v == "admin"
}
func validUserStatus(v string) bool {
	return v == "invited" || v == "active" || v == "suspended" || v == "deactivated"
}
func validEmail(v string) bool {
	v = strings.TrimSpace(v)
	at := strings.IndexByte(v, '@')
	return at > 0 && at < len(v)-1 && !strings.ContainsAny(v, " \t\r\n")
}
func adminUnavailable(w http.ResponseWriter) {
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "administration data is unavailable"})
}
