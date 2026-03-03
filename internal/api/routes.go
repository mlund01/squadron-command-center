package api

import (
	"encoding/json"
	"net/http"

	"commander/internal/hub"
)

// RegisterRoutes registers all REST API endpoints.
func RegisterRoutes(mux *http.ServeMux, h *hub.Hub) {
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
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/events", handleMissionEvents(h))
	mux.HandleFunc("GET /api/instances/{id}/history", handleMissionHistory(h))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/detail", handleGetMission(h))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/history-events", handleGetMissionEvents(h))
	mux.HandleFunc("GET /api/instances/{id}/tasks/{tid}/detail", handleGetTaskDetail(h))
	mux.HandleFunc("GET /api/instances/{id}/missions/{mid}/datasets", handleGetDatasets(h))
	mux.HandleFunc("GET /api/instances/{id}/datasets/{did}/items", handleGetDatasetItems(h))

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

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
