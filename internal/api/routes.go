package api

import (
	"encoding/json"
	"net/http"
	"runtime/debug"
	"sync"

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
func RegisterRoutes(mux *http.ServeMux, h *hub.Hub, ka *keepalive.KeepAlive) {
	// Server info
	mux.HandleFunc("GET /api/info", handleInfo())

	// Keep-alive endpoint for managed lifecycle
	mux.HandleFunc("POST /api/keep-alive", handleKeepAlive(ka))

	mux.HandleFunc("GET /api/instances", handleListInstances(h))
	mux.HandleFunc("GET /api/instances/{id}", handleGetInstance(h))
	mux.HandleFunc("GET /api/instances/{id}/config", handleGetConfig(h))

	// Config reload
	mux.HandleFunc("POST /api/instances/{id}/reload", handleReloadConfig(h))

	// Config file operations
	mux.HandleFunc("GET /api/instances/{id}/config/files", handleListConfigFiles(h))
	mux.HandleFunc("GET /api/instances/{id}/config/files/{name...}", handleGetConfigFile(h))
	mux.HandleFunc("PUT /api/instances/{id}/config/files/{name...}", handleWriteConfigFile(h))
	mux.HandleFunc("POST /api/instances/{id}/config/validate", handleValidateConfig(h))

	// Mission execution endpoints
	mux.HandleFunc("POST /api/instances/{id}/missions/{name}/run", handleRunMission(h))
	mux.HandleFunc("POST /api/instances/{id}/missions/{mid}/stop", handleStopMission(h))
	mux.HandleFunc("POST /api/instances/{id}/missions/{mid}/resume", handleResumeMission(h))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/events", handleMissionEvents(h))
	mux.HandleFunc("GET /api/instances/{id}/history", handleMissionHistory(h))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/detail", handleGetMission(h))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/history-events", handleGetMissionEvents(h))
	mux.HandleFunc("GET /api/instances/{id}/tasks/{tid}/detail", handleGetTaskDetail(h))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/datasets", handleGetDatasets(h))
	mux.HandleFunc("GET /api/instances/{id}/datasets/{did}/items", handleGetDatasetItems(h))

	// Cost tracking
	mux.HandleFunc("GET /api/instances/{id}/costs", handleGetCostSummary(h))

	// Shared folder endpoints
	mux.HandleFunc("GET /api/instances/{id}/browsers", handleListSharedFolders(h))
	mux.HandleFunc("GET /api/instances/{id}/browsers/{browser}/browse", handleBrowseDirectory(h))
	mux.HandleFunc("GET /api/instances/{id}/browsers/{browser}/read", handleReadBrowseFile(h))
	mux.HandleFunc("PUT /api/instances/{id}/browsers/{browser}/write", handleWriteBrowseFile(h))
	mux.HandleFunc("GET /api/instances/{id}/browsers/{browser}/download", handleDownloadFile(h))
	mux.HandleFunc("GET /api/instances/{id}/browsers/{browser}/download-dir", handleDownloadDirectory(h))

	// Variable operations
	mux.HandleFunc("GET /api/instances/{id}/variables", handleGetVariables(h))
	mux.HandleFunc("PUT /api/instances/{id}/variables/{name}", handleSetVariable(h))
	mux.HandleFunc("DELETE /api/instances/{id}/variables/{name}", handleDeleteVariable(h))

	// Webhook trigger endpoints
	mux.HandleFunc("POST /webhooks/{instanceName}/{webhookPath...}", handleWebhook(h))

	// Agent chat endpoints
	mux.HandleFunc("POST /api/instances/{id}/agents/{name}/chat", handleChatMessage(h))
	mux.HandleFunc("GET /api/instances/{id}/chat/{sessionId}/events", handleChatEvents(h))

	// Chat history & management endpoints
	mux.HandleFunc("GET /api/instances/{id}/agents/{name}/chats", handleChatHistory(h))
	mux.HandleFunc("GET /api/instances/{id}/chats/{sessionId}/messages", handleChatMessages(h))
	mux.HandleFunc("DELETE /api/instances/{id}/chats/{sessionId}", handleArchiveChat(h))
}

func handleListInstances(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instances := h.GetRegistry().ListInstances()
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

func handleInfo() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scheme := "http"
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"baseUrl": scheme + "://" + r.Host,
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
