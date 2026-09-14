package api

import (
	"net/http"
	"strings"

	"commander/internal/hub"
	"github.com/mlund01/squadron-wire/protocol"
)

const (
	typeListLocalPluginFiles       protocol.MessageType = "list_local_plugin_files"
	typeListLocalPluginFilesResult protocol.MessageType = "list_local_plugin_files_result"
	typeGetLocalPluginFile         protocol.MessageType = "get_local_plugin_file"
	typeGetLocalPluginFileResult   protocol.MessageType = "get_local_plugin_file_result"
)

type localPluginSourceRequest struct {
	PluginName string `json:"pluginName"`
	Path       string `json:"path,omitempty"`
}

func handleWorkspacePluginFiles(h *hub.Hub, store WorkspaceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := currentControlPlaneUser(w, r, store); !ok {
			return
		}
		instance := h.GetRegistry().GetInstanceByWorkspaceID(r.PathValue("id"))
		if instance == nil || !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Connect the workspace runner to inspect local plugins."})
			return
		}

		path := strings.TrimSpace(r.URL.Query().Get("path"))
		messageType, expectedType := typeListLocalPluginFiles, typeListLocalPluginFilesResult
		if path != "" {
			messageType, expectedType = typeGetLocalPluginFile, typeGetLocalPluginFileResult
		}
		request, err := protocol.NewRequest(messageType, localPluginSourceRequest{
			PluginName: r.PathValue("name"),
			Path:       path,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to create plugin source request."})
			return
		}
		response, err := h.SendRequest(instance.ID, request, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": "The runner did not respond. Check its connection and version."})
			return
		}
		if response.Type == protocol.TypeError {
			var failure protocol.ErrorPayload
			if protocol.DecodePayload(response, &failure) != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Invalid runner response."})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": failure.Message})
			return
		}
		if response.Type != expectedType {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Update Squadron to browse local plugin source."})
			return
		}
		var result map[string]any
		if protocol.DecodePayload(response, &result) != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Invalid runner response."})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, result)
	}
}
