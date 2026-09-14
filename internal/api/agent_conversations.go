package api

import (
	"encoding/json"
	"mime"
	"net/http"
	"strings"

	"commander/internal/hub"
	"github.com/mlund01/squadron-wire/protocol"
)

// A dedicated protocol message prevents older runners from silently treating
// authoring as an operational chat. Owner is supplied by the server, never UI.
type agentConversationRequest struct {
	Operation string `json:"operation"`
	Owner     string `json:"owner"`
	AgentName string `json:"agentName"`
	Mission   string `json:"mission,omitempty"`
	Purpose   string `json:"purpose"`
	Mode      string `json:"mode"`
	SessionID string `json:"sessionId,omitempty"`
	Content   string `json:"content,omitempty"`
}

func handleAgentConversation(h *hub.Hub, store WorkspaceStore, operation string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		instance := h.GetRegistry().GetInstanceByWorkspaceID(r.PathValue("id"))
		if instance == nil || !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Connect the workspace runner to continue."})
			return
		}
		var body agentConversationRequest
		if r.Method == http.MethodPost {
			mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if mediaType != "application/json" {
				writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "A JSON request is required."})
				return
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid conversation request."})
				return
			}
		} else {
			body.Mission, body.Purpose, body.Mode = r.URL.Query().Get("mission"), r.URL.Query().Get("purpose"), r.URL.Query().Get("mode")
		}
		body.Operation, body.Owner, body.AgentName = operation, user.ID, r.PathValue("name")
		if operation != "send" && operation != "list" {
			body.SessionID = r.PathValue("sessionId")
		}
		messageType := protocol.MessageType("agent_conversation")
		expectedType := protocol.MessageType("agent_conversation_result")
		if operation == "definition" {
			messageType, expectedType = "get_agent_definition", "agent_definition_result"
		} else if (body.Purpose != "authoring" && body.Purpose != "session") || (body.Mode != "interactive" && body.Mode != "task") || (body.Purpose == "authoring" && body.Mode != "interactive") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid conversation purpose or mode."})
			return
		}
		if operation == "send" && (strings.TrimSpace(body.Content) == "" || len(body.Content) > 64<<10) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Message must be between 1 and 65536 bytes."})
			return
		}
		req, err := protocol.NewRequest(messageType, body)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to create request."})
			return
		}
		resp, err := h.SendRequest(instance.ID, req, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": "The runner did not respond. Check its connection and version."})
			return
		}
		if resp.Type == protocol.TypeError {
			var failure protocol.ErrorPayload
			if protocol.DecodePayload(resp, &failure) != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Invalid runner response."})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": failure.Message})
			return
		}
		if resp.Type != expectedType {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Update Squadron to use agent conversations."})
			return
		}
		var result map[string]any
		if protocol.DecodePayload(resp, &result) != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Invalid runner response."})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, result)
	}
}
