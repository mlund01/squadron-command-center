package api

import (
	"net/http"

	"commander/internal/auth"
	"commander/internal/hub"
)

var workspaceRoleRank = map[string]int{
	"reader":    1,
	"developer": 2,
	"manager":   3,
	"admin":     4,
}

func requireWorkspaceRole(store AuthorizationStore, minimumRole string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			next(w, r)
			return
		}
		if !authorizeWorkspaceRole(w, r, store, r.PathValue("id"), minimumRole) {
			return
		}
		next(w, r)
	}
}

func requireInstanceWorkspaceRole(h *hub.Hub, store AuthorizationStore, minimumRole string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			next(w, r)
			return
		}
		instance := h.GetRegistry().GetInstance(r.PathValue("id"))
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if instance.WorkspaceID == "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "instance is not assigned to a workspace"})
			return
		}
		if !authorizeWorkspaceRole(w, r, store, instance.WorkspaceID, minimumRole) {
			return
		}
		next(w, r)
	}
}

func authorizeWorkspaceRole(w http.ResponseWriter, r *http.Request, store AuthorizationStore, workspaceID, minimumRole string) bool {
	session := auth.SessionFromContext(r.Context())
	if session == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return false
	}
	if session.Kind == "service_principal" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "this endpoint requires a user workspace role"})
		return false
	}
	user, ok := currentControlPlaneUser(w, r, store)
	if !ok {
		return false
	}
	role, err := store.WorkspaceRoleForUser(r.Context(), user, workspaceID)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace authorization unavailable"})
		return false
	}
	if workspaceRoleRank[role] < workspaceRoleRank[minimumRole] {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": minimumRole + " workspace access is required"})
		return false
	}
	return true
}
