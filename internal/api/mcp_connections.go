package api

import (
	"context"
	"errors"
	"net/http"

	"commander/internal/auth"
	"commander/internal/controlplane"
	"github.com/google/uuid"
)

// MCPConnectionCredentialStore exposes only non-secret status and revocation
// to browser handlers. Credential acquisition and use stay on server paths.
type MCPConnectionCredentialStore interface {
	ListMCPConnectionCredentials(context.Context, controlplane.MCPIdentity) ([]controlplane.MCPConnectionCredential, error)
	RevokeMCPConnectionCredential(context.Context, string, string, controlplane.MCPIdentity, string) error
}

func myMCPIdentity(w http.ResponseWriter, r *http.Request, users controlPlaneUserStore) (controlplane.MCPIdentity, bool) {
	session := auth.SessionFromContext(r.Context())
	if session != nil && session.Kind == "service_principal" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "a user session is required"})
		return controlplane.MCPIdentity{}, false
	}
	user, ok := currentControlPlaneUser(w, r, users)
	if !ok {
		return controlplane.MCPIdentity{}, false
	}
	return controlplane.MCPIdentity{Kind: "user", ID: user.ID}, true
}

func handleMyMCPConnections(users controlPlaneUserStore, store MCPConnectionCredentialStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := myMCPIdentity(w, r, users)
		if !ok {
			return
		}
		listMCPConnectionStatus(w, r, store, identity)
	}
}

func handleMyMCPConnection(users controlPlaneUserStore, store MCPConnectionCredentialStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := myMCPIdentity(w, r, users)
		if !ok {
			return
		}
		revokeMCPConnection(w, r, store, identity, identity.ID)
	}
}

func handlePrincipalMCPConnections(users controlPlaneUserStore, store MCPConnectionCredentialStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := currentAdmin(w, r, users); !ok {
			return
		}
		if !principalMCPRequest(w, r) {
			return
		}
		listMCPConnectionStatus(w, r, store, controlplane.MCPIdentity{Kind: "service_principal", ID: r.PathValue("id")})
	}
}

func handlePrincipalMCPConnection(users controlPlaneUserStore, store MCPConnectionCredentialStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := currentAdmin(w, r, users)
		if !ok {
			return
		}
		if !principalMCPRequest(w, r) {
			return
		}
		revokeMCPConnection(w, r, store, controlplane.MCPIdentity{Kind: "service_principal", ID: r.PathValue("id")}, actor.ID)
	}
}

func principalMCPRequest(w http.ResponseWriter, r *http.Request) bool {
	if _, err := uuid.Parse(r.PathValue("id")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid service principal ID"})
		return false
	}
	return true
}

func listMCPConnectionStatus(w http.ResponseWriter, r *http.Request, store MCPConnectionCredentialStore, identity controlplane.MCPIdentity) {
	items, err := store.ListMCPConnectionCredentials(r.Context(), identity)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "MCP connection status is unavailable"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"connections": items})
}

func revokeMCPConnection(w http.ResponseWriter, r *http.Request, store MCPConnectionCredentialStore, identity controlplane.MCPIdentity, actorID string) {
	if _, err := uuid.Parse(r.PathValue("workspaceId")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workspace ID"})
		return
	}
	err := store.RevokeMCPConnectionCredential(r.Context(), r.PathValue("workspaceId"), r.PathValue("connectionName"), identity, actorID)
	if errors.Is(err, controlplane.ErrMCPCredentialNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "MCP connection not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "MCP connection could not be disconnected"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
