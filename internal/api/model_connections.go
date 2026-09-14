package api

import (
	"context"
	"encoding/json"
	"net/http"

	"commander/internal/controlplane"
	"commander/internal/hub"
	"github.com/mlund01/squadron-wire/protocol"
)

type WorkspaceModelConnectionStore interface {
	ListWorkspaceModelConnections(context.Context, string) ([]controlplane.WorkspaceModelConnection, error)
	WorkspaceModelConnectionsForRunner(context.Context, string) (map[string]controlplane.RunnerModelConnection, error)
	SetWorkspaceModelConnection(context.Context, controlplane.User, string, string, string, string, *string, bool) error
	DeleteWorkspaceModelConnection(context.Context, controlplane.User, string, string) error
	RevealWorkspaceModelConnectionKey(context.Context, controlplane.User, string, string) (string, error)
}

type modelConnectionInput struct {
	Name          string  `json:"name"`
	Provider      string  `json:"provider"`
	BaseURL       string  `json:"baseUrl"`
	APIKey        *string `json:"apiKey"`
	PromptCaching *bool   `json:"promptCaching"`
}

func handleWorkspaceModelConnections(h *hub.Hub, users WorkspaceStore, store WorkspaceModelConnectionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID := r.PathValue("id")
		actor, ok := currentControlPlaneUser(w, r, users)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			connections, err := store.ListWorkspaceModelConnections(r.Context(), workspaceID)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Model connections are unavailable."})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"connections": connections})
			return
		}
		var input modelConnectionInput
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil || input.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "A connection name and provider are required."})
			return
		}
		if input.Provider != "openai_compatible" && (input.APIKey == nil || *input.APIKey == "") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "An API key is required for this provider."})
			return
		}
		promptCaching := input.PromptCaching == nil || *input.PromptCaching
		if err := store.SetWorkspaceModelConnection(r.Context(), actor, workspaceID, input.Name, input.Provider, input.BaseURL, input.APIKey, promptCaching); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		pushWorkspaceModelConnections(r.Context(), h, store, workspaceID)
		writeJSON(w, http.StatusCreated, map[string]bool{"success": true})
	}
}

func handleWorkspaceModelConnection(h *hub.Hub, users WorkspaceStore, store WorkspaceModelConnectionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID, name := r.PathValue("id"), r.PathValue("name")
		actor, ok := currentControlPlaneUser(w, r, users)
		if !ok {
			return
		}
		if r.Method == http.MethodDelete {
			if err := store.DeleteWorkspaceModelConnection(r.Context(), actor, workspaceID, name); err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
				return
			}
			pushWorkspaceModelConnections(r.Context(), h, store, workspaceID)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var input modelConnectionInput
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid model connection."})
			return
		}
		promptCaching := input.PromptCaching == nil || *input.PromptCaching
		if err := store.SetWorkspaceModelConnection(r.Context(), actor, workspaceID, name, input.Provider, input.BaseURL, input.APIKey, promptCaching); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		pushWorkspaceModelConnections(r.Context(), h, store, workspaceID)
		writeJSON(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func handleRevealWorkspaceModelConnection(users WorkspaceStore, store WorkspaceModelConnectionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := currentControlPlaneUser(w, r, users)
		if !ok {
			return
		}
		value, err := store.RevealWorkspaceModelConnectionKey(r.Context(), actor, r.PathValue("id"), r.PathValue("name"))
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]string{"value": value})
	}
}

func pushWorkspaceModelConnections(ctx context.Context, h *hub.Hub, store WorkspaceModelConnectionStore, workspaceID string) {
	connections, err := store.WorkspaceModelConnectionsForRunner(ctx, workspaceID)
	if err != nil {
		return
	}
	instance := h.GetRegistry().GetInstanceByWorkspaceID(workspaceID)
	if instance == nil || !instance.Connected {
		return
	}
	envelope, err := protocol.NewEvent("sync_model_connections", map[string]any{"connections": connections})
	if err == nil {
		_ = h.SendMessage(instance.ID, envelope)
	}
}
