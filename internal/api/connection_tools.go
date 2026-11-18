package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"commander/internal/controlplane"
	"commander/internal/hub"
	"commander/internal/mcpauth"
	"commander/internal/mcptools"
	"github.com/mark3labs/mcp-go/client/transport"
)

type workspaceConnectionStore interface {
	controlPlaneUserStore
	ListWorkspaceConnectionIdentities(context.Context, controlplane.User, string) ([]controlplane.MissionRunIdentity, error)
	LoadActiveMCPConnectionCredential(context.Context, string, string, controlplane.MCPIdentity, string) (controlplane.MCPConnectionCredential, controlplane.MCPSecretMaterial, error)
}

type mcpToolLister func(context.Context, string, map[string]string) ([]mcptools.Tool, error)

func handleWorkspaceConnectionIdentities(store workspaceConnectionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		identities, err := store.ListWorkspaceConnectionIdentities(r.Context(), user, r.PathValue("id"))
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "connection contexts are unavailable"})
			return
		}
		contexts := make([]map[string]any, 0, len(identities))
		for _, identity := range identities {
			contexts = append(contexts, map[string]any{
				"kind": identity.Kind, "id": identity.ID, "name": identity.Name,
				"canManage": identity.Kind == "user" || user.Role == controlplane.RoleAdmin,
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"identities": contexts})
	}
}

func handleWorkspaceMCPTools(h *hub.Hub, store workspaceConnectionStore, listTools mcpToolLister) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		workspaceID := r.PathValue("id")
		identity := controlplane.MCPIdentity{Kind: r.URL.Query().Get("identityKind"), ID: r.URL.Query().Get("identityId")}
		if identity.Kind == "" && identity.ID == "" {
			identity = controlplane.MCPIdentity{Kind: "user", ID: user.ID}
		}
		allowed, err := store.ListWorkspaceConnectionIdentities(r.Context(), user, workspaceID)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "connection context is unavailable"})
			return
		}
		if !containsConnectionIdentity(allowed, identity) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "connection context is not available"})
			return
		}
		instance := h.GetRegistry().GetInstanceByWorkspaceID(workspaceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace runner has not reported configuration"})
			return
		}
		var connectionURL string
		for _, connection := range instance.Config.Plugins {
			if connection.Kind == "mcp" && connection.Name == r.PathValue("name") {
				connectionURL = connection.Path
				if !mcpauth.PublicHTTPS(connectionURL) {
					// Local and process MCP servers have only the runner's shared
					// tool snapshot; never label it as identity-specific.
					writeJSON(w, http.StatusOK, map[string]any{"status": "runner_snapshot", "tools": connection.Tools})
					return
				}
				break
			}
		}
		if connectionURL == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "MCP connection not found"})
			return
		}
		credential, material, err := store.LoadActiveMCPConnectionCredential(r.Context(), workspaceID, r.PathValue("name"), identity, connectionURL)
		switch {
		case errors.Is(err, controlplane.ErrMCPConnectionChanged), errors.Is(err, controlplane.ErrMCPCredentialNeedsAction):
			writeConnectionTools(w, "needs_action", nil)
			return
		case errors.Is(err, controlplane.ErrMCPCredentialNotFound):
			// A public MCP server can allow anonymous tools/list. Inspect it
			// without a credential before calling authorization required.
		case err != nil:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "connection authorization is unavailable"})
			return
		default:
			if credential.AccessExpiresAt != nil && !credential.AccessExpiresAt.After(time.Now().Add(15*time.Second)) {
				writeConnectionTools(w, "needs_action", nil)
				return
			}
		}
		headers := map[string]string{}
		if err == nil {
			switch credential.Method {
			case "static_header":
				headers[material.StaticHeaderName] = material.StaticHeaderValue
			case "authorization_code", "client_credentials":
				if material.AccessToken == "" || (material.TokenType != "" && material.TokenType != "Bearer") {
					writeConnectionTools(w, "needs_action", nil)
					return
				}
				headers["Authorization"] = "Bearer " + material.AccessToken
			default:
				writeConnectionTools(w, "needs_action", nil)
				return
			}
		}
		tools, listErr := listTools(r.Context(), connectionURL, headers)
		if listErr != nil {
			if errors.Is(listErr, transport.ErrUnauthorized) {
				if err == nil {
					writeConnectionTools(w, "needs_action", nil)
				} else {
					writeConnectionTools(w, "authorization_required", nil)
				}
				return
			}
			writeConnectionTools(w, "unavailable", nil)
			return
		}
		writeConnectionTools(w, "available", tools)
	}
}

func containsConnectionIdentity(identities []controlplane.MissionRunIdentity, selected controlplane.MCPIdentity) bool {
	for _, identity := range identities {
		if identity.Kind == selected.Kind && identity.ID == selected.ID {
			return true
		}
	}
	return false
}

func writeConnectionTools(w http.ResponseWriter, status string, tools []mcptools.Tool) {
	if tools == nil {
		tools = []mcptools.Tool{}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"status": status, "tools": tools})
}
