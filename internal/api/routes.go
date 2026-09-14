package api

import (
	"context"
	"encoding/json"
	"net/http"
	"runtime/debug"
	"sync"

	"commander/internal/auth"
	"commander/internal/controlplane"
	"commander/internal/hub"
	"commander/internal/keepalive"
)

// Version is overridable at build time via -ldflags "-X commander/internal/api.Version=vX.Y.Z".
// When empty, we fall back to the VCS revision from the embedded build info.
var Version = ""

// Resolved version string cached on first read — build info never changes at runtime.
var (
	cachedVersion     string
	cachedVersionOnce sync.Once
)

func commanderVersion() string {
	cachedVersionOnce.Do(func() {
		if Version != "" {
			cachedVersion = Version
			return
		}
		if info, ok := debug.ReadBuildInfo(); ok {
			for _, s := range info.Settings {
				if s.Key == "vcs.revision" {
					if len(s.Value) > 7 {
						cachedVersion = s.Value[:7]
					} else {
						cachedVersion = s.Value
					}
					return
				}
			}
		}
		cachedVersion = "dev"
	})
	return cachedVersion
}

// RegisterRoutes registers all REST API endpoints.
// ka is an optional KeepAlive for managed lifecycle (nil to disable).
func RegisterRoutes(mux *http.ServeMux, h *hub.Hub, ka *keepalive.KeepAlive, publicURL string, workspaceStore WorkspaceStore) {
	// Server info
	mux.HandleFunc("GET /api/info", handleInfo(publicURL))
	if workspaceStore != nil {
		mux.HandleFunc("GET /api/workspaces", handleListWorkspaces(workspaceStore))
		mux.HandleFunc("POST /api/workspaces", handleCreateWorkspace(workspaceStore))
		authorizationStore, _ := workspaceStore.(AuthorizationStore)
		mux.HandleFunc("GET /api/workspaces/{id}/config", requireWorkspaceRole(authorizationStore, "reader", handleGetWorkspaceConfig(h)))
		if variableStore, ok := workspaceStore.(WorkspaceVariableStore); ok {
			mux.HandleFunc("GET /api/workspaces/{id}/variables", requireWorkspaceRole(authorizationStore, "manager", handleWorkspaceVariables(h, workspaceStore, variableStore)))
			mux.HandleFunc("POST /api/workspaces/{id}/variables", requireWorkspaceRole(authorizationStore, "manager", handleWorkspaceVariables(h, workspaceStore, variableStore)))
			mux.HandleFunc("PUT /api/workspaces/{id}/variables/{name}", requireWorkspaceRole(authorizationStore, "manager", handleWorkspaceVariable(h, workspaceStore, variableStore)))
			mux.HandleFunc("GET /api/workspaces/{id}/variables/{name}", requireWorkspaceRole(authorizationStore, "manager", handleWorkspaceVariable(h, workspaceStore, variableStore)))
			mux.HandleFunc("DELETE /api/workspaces/{id}/variables/{name}", requireWorkspaceRole(authorizationStore, "manager", handleWorkspaceVariable(h, workspaceStore, variableStore)))
		}
		if modelStore, ok := workspaceStore.(WorkspaceModelConnectionStore); ok {
			mux.HandleFunc("GET /api/workspaces/{id}/model-connections", requireWorkspaceRole(authorizationStore, "manager", handleWorkspaceModelConnections(h, workspaceStore, modelStore)))
			mux.HandleFunc("POST /api/workspaces/{id}/model-connections", requireWorkspaceRole(authorizationStore, "manager", handleWorkspaceModelConnections(h, workspaceStore, modelStore)))
			mux.HandleFunc("PUT /api/workspaces/{id}/model-connections/{name}", requireWorkspaceRole(authorizationStore, "manager", handleWorkspaceModelConnection(h, workspaceStore, modelStore)))
			mux.HandleFunc("DELETE /api/workspaces/{id}/model-connections/{name}", requireWorkspaceRole(authorizationStore, "manager", handleWorkspaceModelConnection(h, workspaceStore, modelStore)))
			mux.HandleFunc("GET /api/workspaces/{id}/model-connections/{name}/credential", requireWorkspaceRole(authorizationStore, "manager", handleRevealWorkspaceModelConnection(workspaceStore, modelStore)))
		}
		mux.HandleFunc("GET /api/workspaces/{id}/plugins/{name}/files", requireWorkspaceRole(authorizationStore, "reader", handleWorkspacePluginFiles(h, workspaceStore)))
		mux.HandleFunc("GET /api/workspaces/{id}/agents/{name}/definition", requireWorkspaceRole(authorizationStore, "reader", handleAgentConversation(h, workspaceStore, "definition")))
		mux.HandleFunc("GET /api/workspaces/{id}/missions/{name}/definition", requireWorkspaceRole(authorizationStore, "reader", handleMissionDefinition(h)))
		mux.HandleFunc("POST /api/workspaces/{id}/agents/{name}/conversations", requireWorkspaceRole(authorizationStore, "reader", handleAgentConversation(h, workspaceStore, "send")))
		mux.HandleFunc("GET /api/workspaces/{id}/agents/{name}/conversations", requireWorkspaceRole(authorizationStore, "reader", handleAgentConversation(h, workspaceStore, "list")))
		mux.HandleFunc("GET /api/workspaces/{id}/agents/{name}/conversations/{sessionId}", requireWorkspaceRole(authorizationStore, "reader", handleAgentConversation(h, workspaceStore, "read")))
		mux.HandleFunc("POST /api/workspaces/{id}/agents/{name}/conversations/{sessionId}/stop", requireWorkspaceRole(authorizationStore, "reader", handleAgentConversation(h, workspaceStore, "stop")))
		if scheduleStore, ok := workspaceStore.(ScheduleStore); ok {
			mux.HandleFunc("GET /api/workspaces/{id}/schedules", requireWorkspaceRole(authorizationStore, "reader", handleWorkspaceMissionSchedules(scheduleStore)))
			mux.HandleFunc("GET /api/workspaces/{id}/missions/{name}/schedules", requireWorkspaceRole(authorizationStore, "reader", handleMissionSchedules(scheduleStore)))
			mux.HandleFunc("POST /api/workspaces/{id}/missions/{name}/schedules", requireWorkspaceRole(authorizationStore, "manager", handleMissionSchedules(scheduleStore)))
			mux.HandleFunc("PUT /api/workspaces/{id}/missions/{name}/schedules/{scheduleId}", requireWorkspaceRole(authorizationStore, "manager", handleMissionSchedule(scheduleStore)))
			mux.HandleFunc("DELETE /api/workspaces/{id}/missions/{name}/schedules/{scheduleId}", requireWorkspaceRole(authorizationStore, "manager", handleMissionSchedule(scheduleStore)))
		}
		mux.HandleFunc("POST /api/workspaces/{id}/worker-enrollment", handleProvisionWorker(workspaceStore, publicURL))
		mux.HandleFunc("GET /api/workspaces/{id}/worker-credential", handleRevealWorkerCredential(workspaceStore, publicURL))
		if adminStore, ok := workspaceStore.(AdminStore); ok {
			mux.HandleFunc("GET /api/admin/users", handleAdminUsers(adminStore))
			mux.HandleFunc("POST /api/admin/users", handleAdminUsers(adminStore))
			mux.HandleFunc("PATCH /api/admin/users/{id}", handleAdminUser(adminStore))
			mux.HandleFunc("GET /api/admin/service-principals", handleAdminServicePrincipals(adminStore))
			mux.HandleFunc("POST /api/admin/service-principals", handleAdminServicePrincipals(adminStore))
			mux.HandleFunc("PATCH /api/admin/service-principals/{id}", handleAdminServicePrincipal(adminStore))
			mux.HandleFunc("POST /api/admin/service-principals/{id}/rotate", handleRotateServicePrincipalCredential(adminStore))
			mux.HandleFunc("GET /api/admin/audit", handleAdminAudit(adminStore))
			mux.HandleFunc("GET /api/admin/access", handleAdminAccess(adminStore))
			mux.HandleFunc("PUT /api/admin/workspaces/{workspaceId}/users/{userId}", handleAdminWorkspaceUserAccess(adminStore))
			mux.HandleFunc("DELETE /api/admin/workspaces/{workspaceId}/users/{userId}", handleAdminWorkspaceUserAccess(adminStore))
			mux.HandleFunc("PUT /api/admin/workspaces/{workspaceId}/service-principals/{servicePrincipalId}", handleAdminWorkspaceServicePrincipalAccess(adminStore))
			mux.HandleFunc("DELETE /api/admin/workspaces/{workspaceId}/service-principals/{servicePrincipalId}", handleAdminWorkspaceServicePrincipalAccess(adminStore))
		}
	}

	// Keep-alive endpoint for managed lifecycle
	mux.HandleFunc("POST /api/keep-alive", handleKeepAlive(ka))

	authorizationStore, _ := workspaceStore.(AuthorizationStore)
	mux.HandleFunc("GET /api/instances", handleListInstances(h, authorizationStore))
	mux.HandleFunc("GET /api/instances/{id}", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleGetInstance(h)))
	mux.HandleFunc("GET /api/instances/{id}/config", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleGetConfig(h)))

	// Config reload
	mux.HandleFunc("POST /api/instances/{id}/reload", requireInstanceWorkspaceRole(h, authorizationStore, "developer", handleReloadConfig(h)))

	// Config file operations
	mux.HandleFunc("GET /api/instances/{id}/config/files", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleListConfigFiles(h)))
	mux.HandleFunc("GET /api/instances/{id}/config/files/{name...}", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleGetConfigFile(h)))
	mux.HandleFunc("PUT /api/instances/{id}/config/files/{name...}", requireInstanceWorkspaceRole(h, authorizationStore, "developer", handleWriteConfigFile(h)))
	mux.HandleFunc("POST /api/instances/{id}/config/validate", requireInstanceWorkspaceRole(h, authorizationStore, "developer", handleValidateConfig(h)))

	// Mission execution endpoints
	mux.HandleFunc("POST /api/instances/{id}/missions/{name}/run", handleRunMission(h, authorizationStore))
	mux.HandleFunc("GET /api/instances/{id}/missions/{name}/run-identities", handleMissionRunIdentities(h, authorizationStore))
	mux.HandleFunc("POST /api/instances/{id}/missions/{mid}/stop", handleStopMission(h, authorizationStore))
	mux.HandleFunc("POST /api/instances/{id}/missions/{mid}/resume", handleResumeMission(h, authorizationStore))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/events", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleMissionEvents(h)))
	mux.HandleFunc("GET /api/instances/{id}/history", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleMissionHistory(h)))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/detail", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleGetMission(h)))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/history-events", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleGetMissionEvents(h)))
	mux.HandleFunc("GET /api/instances/{id}/tasks/{tid}/detail", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleGetTaskDetail(h)))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/datasets", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleGetDatasets(h)))
	mux.HandleFunc("GET /api/instances/{id}/datasets/{did}/items", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleGetDatasetItems(h)))

	// Cost tracking
	mux.HandleFunc("GET /api/instances/{id}/costs", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleGetCostSummary(h)))

	// Shared folder endpoints
	mux.HandleFunc("GET /api/instances/{id}/browsers", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleListSharedFolders(h)))
	mux.HandleFunc("GET /api/instances/{id}/browsers/{browser}/browse", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleBrowseDirectory(h)))
	mux.HandleFunc("GET /api/instances/{id}/browsers/{browser}/read", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleReadBrowseFile(h)))
	mux.HandleFunc("PUT /api/instances/{id}/browsers/{browser}/write", requireInstanceWorkspaceRole(h, authorizationStore, "developer", handleWriteBrowseFile(h)))
	mux.HandleFunc("GET /api/instances/{id}/browsers/{browser}/download", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleDownloadFile(h)))
	mux.HandleFunc("GET /api/instances/{id}/browsers/{browser}/download-dir", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleDownloadDirectory(h)))

	// Webhook trigger endpoints
	mux.HandleFunc("POST /webhooks/{instanceName}/{webhookPath...}", handleWebhook(h))

	// Agent chat endpoints
	mux.HandleFunc("POST /api/instances/{id}/agents/{name}/chat", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleChatMessage(h)))
	mux.HandleFunc("GET /api/instances/{id}/chat/{sessionId}/events", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleChatEvents(h)))

	// Chat history & management endpoints
	mux.HandleFunc("GET /api/instances/{id}/agents/{name}/chats", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleChatHistory(h)))
	mux.HandleFunc("GET /api/instances/{id}/chats/{sessionId}/messages", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleChatMessages(h)))
	mux.HandleFunc("DELETE /api/instances/{id}/chats/{sessionId}", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleArchiveChat(h)))

	// Human-in-the-loop (ask_human) endpoints — commander proxies to
	// the squadron that owns the records.
	mux.HandleFunc("GET /api/instances/{id}/human-inputs", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleListHumanInputs(h)))
	mux.HandleFunc("GET /api/instances/{id}/human-inputs/stream", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleStreamHumanInputs(h)))
	mux.HandleFunc("POST /api/instances/{id}/human-inputs/{callId}/resolve", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleResolveHumanInput(h)))

	// Mission-lifecycle notifications (in-memory; dismiss is session-scoped)
	mux.HandleFunc("GET /api/instances/{id}/notifications", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleListNotifications(h)))
	mux.HandleFunc("GET /api/instances/{id}/notifications/stream", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleStreamNotifications(h)))
	mux.HandleFunc("DELETE /api/instances/{id}/notifications/{nid}", requireInstanceWorkspaceRole(h, authorizationStore, "reader", handleDismissNotification(h)))
}

// WorkspaceStore is the subset of the control plane needed by workspace
// handlers. Keeping it narrow makes HTTP behavior testable without Postgres.
type WorkspaceStore interface {
	UserForSubject(rctx context.Context, subject string) (controlplane.User, error)
	ListWorkspaces(rctx context.Context) ([]controlplane.Workspace, error)
	CreateWorkspace(rctx context.Context, owner controlplane.User, name, repositoryURL string) (controlplane.Workspace, error)
	ProvisionWorkspaceWorker(rctx context.Context, workspaceID, credential string) (controlplane.WorkspaceWorker, error)
	RevealWorkspaceWorkerCredential(rctx context.Context, workspaceID string) (string, error)
}

type AuthorizationStore interface {
	UserForSubject(context.Context, string) (controlplane.User, error)
	WorkspaceRoleForUser(context.Context, controlplane.User, string) (string, error)
	CanRunMission(context.Context, controlplane.User, string, string) (bool, error)
	ListMissionRunIdentities(context.Context, controlplane.User, string, string) ([]controlplane.MissionRunIdentity, error)
	CanUserRunAsServicePrincipal(context.Context, controlplane.User, string, string, string) (bool, error)
	RecordMissionRunActor(context.Context, controlplane.User, string, string, string) error
	RecordMissionRunAsServicePrincipal(context.Context, controlplane.User, string, string, string, string) error
	CanControlMissionRun(context.Context, controlplane.User, string, string) (bool, error)
	CanRunMissionServicePrincipal(context.Context, string, string, string) (bool, error)
	RecordMissionRunServicePrincipal(context.Context, string, string, string, string) error
	CanControlMissionRunServicePrincipal(context.Context, string, string, string) (bool, error)
}

func handleListInstances(h *hub.Hub, stores ...AuthorizationStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instances := h.GetRegistry().ListInstances()
		if len(stores) > 0 && stores[0] != nil {
			store := stores[0]
			session := auth.SessionFromContext(r.Context())
			if session == nil || session.Kind == "service_principal" {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "workspace access is required"})
				return
			}
			user, ok := currentControlPlaneUser(w, r, store)
			if !ok {
				return
			}
			visible := instances[:0]
			for _, instance := range instances {
				role, err := store.WorkspaceRoleForUser(r.Context(), user, instance.WorkspaceID)
				if err != nil {
					writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace authorization unavailable"})
					return
				}
				if role != "" {
					visible = append(visible, instance)
				}
			}
			instances = visible
		}
		writeJSON(w, http.StatusOK, instances)
	}
}

func handleGetInstance(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		instance := h.GetRegistry().GetInstance(id)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		writeJSON(w, http.StatusOK, instance)
	}
}

func handleGetConfig(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		instance := h.GetRegistry().GetInstance(id)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}
		writeJSON(w, http.StatusOK, instance.Config)
	}
}

func handleInfo(publicURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		baseURL := publicURL
		if baseURL == "" {
			scheme := "http"
			if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
				scheme = "https"
			}
			baseURL = scheme + "://" + r.Host
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"baseUrl": baseURL,
			"version": commanderVersion(),
		})
	}
}

func handleKeepAlive(ka *keepalive.KeepAlive) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ka != nil {
			ka.Reset()
		}
		w.WriteHeader(http.StatusOK)
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
