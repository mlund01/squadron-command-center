package api

import (
	"context"
	"encoding/json"
	"net/http"

	"commander/internal/controlplane"
	"commander/internal/hub"
	"github.com/mlund01/squadron-wire/protocol"
)

type WorkspaceVariableStore interface {
	ListWorkspaceVariables(context.Context, string) ([]controlplane.WorkspaceVariable, error)
	WorkspaceVariablesForRunner(context.Context, string) (map[string]string, error)
	SetWorkspaceVariable(context.Context, controlplane.User, string, string, string, bool) error
	DeleteWorkspaceVariable(context.Context, controlplane.User, string, string) error
	RevealWorkspaceVariable(context.Context, controlplane.User, string, string) (string, error)
}

func handleWorkspaceVariables(h *hub.Hub, users WorkspaceStore, variables WorkspaceVariableStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID := r.PathValue("id")
		actor, ok := currentControlPlaneUser(w, r, users)
		if !ok {
			return
		}
		stored, err := variables.ListWorkspaceVariables(r.Context(), workspaceID)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Workspace variables are unavailable."})
			return
		}
		if r.Method == http.MethodGet {
			writeJSON(w, http.StatusOK, map[string]any{"variables": mergeWorkspaceVariables(stored, workspaceVariableDeclarations(h, workspaceID))})
			return
		}
		var body struct {
			Name   string `json:"name"`
			Value  string `json:"value"`
			Secret *bool  `json:"secret"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil || body.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "A variable name and value are required."})
			return
		}
		secret := declaredVariableSecret(h, workspaceID, body.Name)
		if body.Secret != nil {
			secret = *body.Secret
		}
		if err := variables.SetWorkspaceVariable(r.Context(), actor, workspaceID, body.Name, body.Value, secret); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		pushWorkspaceVariables(r.Context(), h, variables, workspaceID)
		writeJSON(w, http.StatusCreated, map[string]bool{"success": true})
	}
}

func handleWorkspaceVariable(h *hub.Hub, users WorkspaceStore, variables WorkspaceVariableStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID, name := r.PathValue("id"), r.PathValue("name")
		actor, ok := currentControlPlaneUser(w, r, users)
		if !ok {
			return
		}
		if r.Method == http.MethodDelete {
			if err := variables.DeleteWorkspaceVariable(r.Context(), actor, workspaceID, name); err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
				return
			}
			pushWorkspaceVariables(r.Context(), h, variables, workspaceID)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method == http.MethodGet {
			value, err := variables.RevealWorkspaceVariable(r.Context(), actor, workspaceID, name)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			writeJSON(w, http.StatusOK, map[string]string{"value": value})
			return
		}
		var body struct {
			Value  string `json:"value"`
			Secret *bool  `json:"secret"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid variable value."})
			return
		}
		secret := declaredVariableSecret(h, workspaceID, name)
		if body.Secret != nil {
			secret = *body.Secret
		}
		if err := variables.SetWorkspaceVariable(r.Context(), actor, workspaceID, name, body.Value, secret); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		pushWorkspaceVariables(r.Context(), h, variables, workspaceID)
		writeJSON(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func pushWorkspaceVariables(ctx context.Context, h *hub.Hub, store WorkspaceVariableStore, workspaceID string) {
	values, err := store.WorkspaceVariablesForRunner(ctx, workspaceID)
	if err != nil {
		return
	}
	instance := h.GetRegistry().GetInstanceByWorkspaceID(workspaceID)
	if instance == nil || !instance.Connected {
		return
	}
	envelope, err := protocol.NewEvent("sync_variables", map[string]any{"values": values})
	if err == nil {
		_ = h.SendMessage(instance.ID, envelope)
	}
}

func workspaceVariableDeclarations(h *hub.Hub, workspaceID string) []protocol.VariableInfo {
	instance := h.GetRegistry().GetInstanceByWorkspaceID(workspaceID)
	if instance == nil {
		return nil
	}
	return instance.Config.Variables
}

func declaredVariableSecret(h *hub.Hub, workspaceID, name string) bool {
	for _, variable := range workspaceVariableDeclarations(h, workspaceID) {
		if variable.Name == name {
			return variable.Secret
		}
	}
	return false
}

func mergeWorkspaceVariables(stored []controlplane.WorkspaceVariable, declared []protocol.VariableInfo) []controlplane.WorkspaceVariable {
	byName := make(map[string]int, len(stored)+len(declared))
	result := append(make([]controlplane.WorkspaceVariable, 0, len(stored)+len(declared)), stored...)
	for index := range result {
		byName[result[index].Name] = index
	}
	for _, variable := range declared {
		if index, ok := byName[variable.Name]; ok {
			if variable.Secret {
				result[index].Secret, result[index].Value = true, "********"
			}
			continue
		}
		byName[variable.Name] = len(result)
		result = append(result, controlplane.WorkspaceVariable{Name: variable.Name, Secret: variable.Secret})
	}
	return result
}
