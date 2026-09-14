package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"commander/internal/auth"
	"commander/internal/controlplane"
	"commander/internal/hub"
	"github.com/jackc/pgx/v5/pgconn"
)

const maxWorkspaceNameLength = 120
const maxRepositoryURLLength = 2048

type createWorkspaceRequest struct {
	Name          string `json:"name"`
	RepositoryURL string `json:"repositoryUrl"`
}

func handleGetWorkspaceConfig(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instance := h.GetRegistry().GetInstanceByWorkspaceID(r.PathValue("id"))
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace runner has not reported configuration"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"instanceId":  instance.ID,
			"connected":   instance.Connected,
			"configReady": instance.ConfigReady,
			"configError": instance.ConfigError,
			"config":      instance.Config,
		})
	}
}

func handleListWorkspaces(store WorkspaceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}

		var workspaces []controlplane.Workspace
		var err error
		if scoped, ok := store.(interface {
			ListWorkspacesForUser(context.Context, controlplane.User) ([]controlplane.Workspace, error)
		}); ok {
			workspaces, err = scoped.ListWorkspacesForUser(r.Context(), user)
		} else {
			workspaces, err = store.ListWorkspaces(r.Context())
		}
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspaces unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"workspaces": workspaces})
	}
}

func handleCreateWorkspace(store WorkspaceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		if user.Role != controlplane.RoleAdmin {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "an administrator must create workspaces"})
			return
		}

		var request createWorkspaceRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
		if err := decoder.Decode(&request); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workspace request"})
			return
		}

		request.Name = strings.TrimSpace(request.Name)
		request.RepositoryURL = strings.TrimSpace(request.RepositoryURL)
		if request.Name == "" || len(request.Name) > maxWorkspaceNameLength {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "workspace name must be between 1 and 120 characters"})
			return
		}
		if len(request.RepositoryURL) > maxRepositoryURLLength {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "repository URL must be at most 2048 characters"})
			return
		}

		workspace, err := store.CreateWorkspace(r.Context(), user, request.Name, request.RepositoryURL)
		if err != nil {
			if isUniqueViolation(err) {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "a workspace with that name already exists"})
				return
			}
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "unable to create workspace"})
			return
		}

		writeJSON(w, http.StatusCreated, workspace)
	}
}

func handleProvisionWorker(store WorkspaceStore, publicURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		if user.Role != controlplane.RoleAdmin {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "an administrator must provision a worker"})
			return
		}

		credential, err := controlplane.NewWorkerCredential()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "unable to generate worker credential"})
			return
		}
		worker, err := store.ProvisionWorkspaceWorker(r.Context(), r.PathValue("id"), credential)
		if errors.Is(err, controlplane.ErrWorkspaceNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace not found"})
			return
		}
		if errors.Is(err, controlplane.ErrWorkerAlreadyProvisioned) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "this workspace already has a worker"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "unable to provision worker"})
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"worker":           worker,
			"credential":       credential,
			"commandCenterURL": websocketURL(publicURL),
		})
	}
}

func handleRevealWorkerCredential(store WorkspaceStore, publicURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		if user.Role != controlplane.RoleAdmin {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "an administrator must view a worker credential"})
			return
		}

		credential, err := store.RevealWorkspaceWorkerCredential(r.Context(), r.PathValue("id"))
		if errors.Is(err, controlplane.ErrWorkerNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "this workspace does not have a worker"})
			return
		}
		if errors.Is(err, controlplane.ErrWorkerCredentialUnavailable) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "this worker has no stored credential"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "unable to retrieve worker credential"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"credential":       credential,
			"commandCenterURL": websocketURL(publicURL),
		})
	}
}

func websocketURL(publicURL string) string {
	url, err := url.Parse(publicURL)
	if err != nil || url.Host == "" {
		return ""
	}
	switch url.Scheme {
	case "http":
		url.Scheme = "ws"
	case "https":
		url.Scheme = "wss"
	default:
		return ""
	}
	url.Path = "/ws"
	url.RawQuery = ""
	url.Fragment = ""
	return url.String()
}

type controlPlaneUserStore interface {
	UserForSubject(context.Context, string) (controlplane.User, error)
}

func currentControlPlaneUser(w http.ResponseWriter, r *http.Request, store controlPlaneUserStore) (controlplane.User, bool) {
	session := auth.SessionFromContext(r.Context())
	if session == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return controlplane.User{}, false
	}

	user, err := store.UserForSubject(r.Context(), session.Sub)
	if errors.Is(err, controlplane.ErrUserNotFound) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "user is not provisioned for this command center"})
		return controlplane.User{}, false
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user lookup unavailable"})
		return controlplane.User{}, false
	}
	return user, true
}

func isUniqueViolation(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) && databaseError.Code == "23505"
}
